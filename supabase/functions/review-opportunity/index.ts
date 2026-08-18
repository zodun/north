// Edge Function: review-opportunity
// A user submits an opportunity; this records it, then has DeepSeek moderate it
// for the public Opportunities feed:
//   publish     → legitimate + safe: goes live in `opportunities` now
//   reject      → clearly spam/scam/unsafe: marked rejected, not shown
//   needs_human → unsure: left pending for a person to review
//
// Conservative by design: anything the model is not confident about, and any AI
// failure, falls back to needs_human, nothing borderline auto-publishes, and a
// submission is never silently lost.
//
// Operator setup: supabase secrets set DEEPSEEK_API_KEY=sk-...

import { createClient } from "@supabase/supabase-js";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { callDeepSeekTool } from "../_shared/deepseek.ts";
import { stripDashes } from "../_shared/text.ts";
import {
	buildUserPrompt,
	MODEL_NAME,
	type OpportunityInput,
	PROMPT_VERSION,
	REVIEW_TOOL,
	type ReviewResult,
	SYSTEM_PROMPT,
} from "./prompt.ts";

const MAX_DESC = 1200;

function str(v: unknown, max = 200): string | null {
	if (typeof v !== "string") return null;
	const t = v.trim();
	return t ? t.slice(0, max) : null;
}

if (typeof Deno !== "undefined" && Deno.env.get("DENO_TESTING") !== "1") {
	Deno.serve(async (req: Request) => {
		const pf = preflight(req);
		if (pf) return pf;

		const authHeader = req.headers.get("Authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return json({ error: "missing authorization" }, 401);
		}
		const jwt = authHeader.slice(7);

		const supabaseUrl = Deno.env.get("SUPABASE_URL");
		const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
		const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
		if (!supabaseUrl || !serviceRole) {
			return json({ error: "missing env" }, 500);
		}

		const userClient = createClient(
			supabaseUrl,
			Deno.env.get("SUPABASE_ANON_KEY") ?? "",
			{
				global: { headers: { Authorization: `Bearer ${jwt}` } },
				auth: { persistSession: false, autoRefreshToken: false },
			},
		);
		const {
			data: { user },
			error: authErr,
		} = await userClient.auth.getUser();
		if (authErr || !user) return json({ error: "unauthorized" }, 401);

		// ── Parse + validate the submission ──────────────────────────────
		let input: OpportunityInput;
		try {
			const b = (await req.json()) as Record<string, unknown>;
			const title = str(b.title, 200);
			const org = str(b.org, 200);
			const externalUrl = str(b.external_url, 500);
			if (!title || !org || !externalUrl) {
				return json({ error: "title, org and link are required" }, 400);
			}
			if (!/^https?:\/\/\S+\.\S+/i.test(externalUrl)) {
				return json({ error: "link must be a valid URL" }, 400);
			}
			input = {
				title,
				org,
				opportunity_type: str(b.opportunity_type, 60),
				location: str(b.location, 120),
				deadline: str(b.deadline, 60),
				description: str(b.description, MAX_DESC),
				external_url: externalUrl,
			};
		} catch {
			return json({ error: "invalid JSON" }, 400);
		}

		const service = createClient(supabaseUrl, serviceRole, {
			auth: { persistSession: false, autoRefreshToken: false },
		});

		// ── Record the submission (pending) ──────────────────────────────
		const { data: submission, error: subErr } = await service
			.from("opportunity_submissions")
			.insert({
				submitted_by: user.id,
				submitter_email: user.email ?? null,
				title: input.title,
				org: input.org,
				opportunity_type: input.opportunity_type,
				location: input.location,
				deadline: input.deadline,
				description: input.description,
				external_url: input.external_url,
				status: "pending",
			})
			.select("id")
			.single<{ id: string }>();
		if (subErr || !submission) {
			return json({ error: subErr?.message ?? "could not save" }, 500);
		}

		// ── Moderate. Any failure → needs_human (safe default). ──────────
		let review: ReviewResult = {
			decision: "needs_human",
			reason: "Saved for review.",
			why: "",
			tags: [],
		};
		if (deepseekKey) {
			try {
				const r = (await callDeepSeekTool(
					deepseekKey,
					MODEL_NAME,
					SYSTEM_PROMPT,
					buildUserPrompt(input),
					REVIEW_TOOL,
					512,
				)) as Partial<ReviewResult>;
				const decision =
					r.decision === "publish" ||
					r.decision === "reject" ||
					r.decision === "needs_human"
						? r.decision
						: "needs_human";
				review = {
					decision,
					reason: stripDashes(str(r.reason, 280) ?? "Saved for review."),
					why: stripDashes(str(r.why, 200) ?? ""),
					tags: Array.isArray(r.tags)
						? r.tags
								.map((t) => stripDashes(str(t, 40) ?? ""))
								.filter(Boolean)
								.slice(0, 4)
						: [],
				};
			} catch (err) {
				console.error("opportunity review failed:", err);
			}
		}

		// ── Apply the decision ───────────────────────────────────────────
		if (review.decision === "publish") {
			await service.from("opportunities").insert({
				title: input.title,
				org: input.org,
				opportunity_type: input.opportunity_type,
				location: input.location,
				deadline: input.deadline,
				why: review.why || null,
				tags: review.tags,
				external_url: input.external_url,
				published_at: new Date().toISOString(),
			});
			await service
				.from("opportunity_submissions")
				.update({ status: "approved", reviewed_at: new Date().toISOString() })
				.eq("id", submission.id);
		} else if (review.decision === "reject") {
			await service
				.from("opportunity_submissions")
				.update({ status: "rejected", reviewed_at: new Date().toISOString() })
				.eq("id", submission.id);
		}
		// needs_human: left pending for a person.

		return json({
			ok: true,
			decision: review.decision,
			reason: review.reason,
			prompt_version: PROMPT_VERSION,
		});
	});
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...corsHeaders },
	});
}
