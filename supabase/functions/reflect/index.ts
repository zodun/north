// Edge Function: reflect (AI-06)
// Accepts a user's weekly free-text reflection, calls DeepSeek to extract
// themes + alignment signal + mission nudge, writes the analysis back to
// user_reflections, and returns the result to the client immediately.
//
// Auth: user JWT via Authorization header (supabase.functions.invoke sends it
// automatically). The function creates an authenticated client from the JWT to
// verify identity and read focus areas; it uses the service role to write
// analyzed_at + analysis back (client RLS allows insert but not update).
//
// Operator setup (once per environment):
//   supabase secrets set DEEPSEEK_API_KEY=sk-...
//   supabase functions deploy reflect

import { createClient } from "@supabase/supabase-js";

import { corsHeaders, preflight } from "../_shared/cors.ts";
import { callDeepSeekTool } from "../_shared/deepseek.ts";
import { captureServer } from "../_shared/posthog.ts";
import { stripDashes } from "../_shared/text.ts";
import {
	buildUserPrompt,
	MODEL_NAME,
	PROMPT_VERSION,
	REFLECT_TOOL,
	type ReflectionAnalysis,
	type ReflectPayload,
	SYSTEM_PROMPT,
} from "./prompt.ts";

const MAX_BODY_LENGTH = 1000;

if (typeof Deno !== "undefined" && Deno.env.get("DENO_TESTING") !== "1") {
	Deno.serve(async (req: Request) => {
		const pf = preflight(req);
		if (pf) return pf;
		// ── Auth ─────────────────────────────────────────────────────────
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

		// Authenticated client to verify the user and read their data.
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
		if (authErr || !user) {
			return json({ error: "unauthorized" }, 401);
		}

		// ── Parse body ───────────────────────────────────────────────────
		let body: string;
		let entryDate: string;
		try {
			const parsed = (await req.json()) as {
				body?: unknown;
				entry_date?: unknown;
			};
			if (typeof parsed.body !== "string" || parsed.body.trim().length === 0) {
				return json({ error: "body is required" }, 400);
			}
			body = parsed.body.trim().slice(0, MAX_BODY_LENGTH);
			entryDate =
				typeof parsed.entry_date === "string"
					? parsed.entry_date
					: new Date().toISOString().slice(0, 10);
		} catch {
			return json({ error: "invalid JSON" }, 400);
		}

		// ── Fetch context for the prompt ─────────────────────────────────
		// Band context comes from the most recent signal score (weekly), not the
		// journal day.
		const [focusRes, scoreRes] = await Promise.all([
			userClient
				.from("user_focus_areas")
				.select("focus_areas(label)")
				.eq("user_id", user.id),
			userClient
				.from("signal_scores")
				.select("band, provisional")
				.eq("user_id", user.id)
				.order("week_ending", { ascending: false })
				.limit(1)
				.maybeSingle<{ band: string; provisional: boolean }>(),
		]);

		const focusAreas = (
			(focusRes.data ?? []) as { focus_areas: { label: string } | null }[]
		)
			.map((r) => r.focus_areas?.label)
			.filter((l): l is string => Boolean(l));

		// ── Insert reflection row (client identity) ──────────────────────
		const { data: reflection, error: insertErr } = await userClient
			.from("user_reflections")
			.insert({
				user_id: user.id,
				entry_date: entryDate,
				week_ending: entryDate,
				body,
			})
			.select("id")
			.single<{ id: string }>();
		if (insertErr || !reflection) {
			return json({ error: insertErr?.message ?? "insert failed" }, 500);
		}
		const reflectionId = reflection.id;

		// ── Call DeepSeek ────────────────────────────────────────────────
		let analysis: ReflectionAnalysis;
		if (!deepseekKey) {
			// No key configured, return a stub analysis so the UI isn't blocked.
			analysis = {
				signal: ["showed up and reflected"],
				noise: [],
				read: "Notice what pulled your attention today.",
			};
		} else {
			const payload: ReflectPayload = {
				focus_areas: focusAreas,
				band: scoreRes.data?.band ?? "Finding",
				provisional: scoreRes.data?.provisional ?? false,
				reflection_body: body,
			};
			try {
				analysis = (await callDeepSeekTool(
					deepseekKey,
					MODEL_NAME,
					SYSTEM_PROMPT,
					buildUserPrompt(payload),
					REFLECT_TOOL,
					300,
				)) as ReflectionAnalysis;
			} catch (err) {
				// Fallback: save the reflection body without analysis, surface the error.
				const message = err instanceof Error ? err.message : String(err);
				return json({ reflection_id: reflectionId, error: message }, 200);
			}
		}

		// Keep the surfaced analysis dash-free (mirrors migration 0053).
		analysis = {
			...analysis,
			signal: (analysis.signal ?? []).map(stripDashes),
			noise: (analysis.noise ?? []).map(stripDashes),
			read: stripDashes(analysis.read),
		};

		// ── Write analysis back (service role to bypass client update RLS) ─
		const serviceClient = createClient(supabaseUrl, serviceRole, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		await serviceClient
			.from("user_reflections")
			.update({
				analyzed_at: new Date().toISOString(),
				analysis: {
					...analysis,
					model: MODEL_NAME,
					prompt_version: PROMPT_VERSION,
				},
			})
			.eq("id", reflectionId);

		// Today's For You / Opportunities rankings were built from the user's
		// signal/noise; a fresh reflection changes that input, so drop the cached
		// rankings for this day and let the next page load re-rank. Best-effort,
		// a failure here must not block the journal response.
		const today = new Date().toISOString().slice(0, 10);
		await serviceClient
			.from("user_personalization")
			.delete()
			.eq("user_id", user.id)
			.in("day", [...new Set([entryDate, today])]);

		// ── Analytics (best-effort) ──────────────────────────────────────
		await captureServer("journal_analyzed", user.id, {
			entry_date: entryDate,
			signal_count: analysis.signal.length,
			noise_count: analysis.noise.length,
			model: MODEL_NAME,
			prompt_version: PROMPT_VERSION,
		});

		return json({ reflection_id: reflectionId, analysis });
	});
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...corsHeaders },
	});
}
