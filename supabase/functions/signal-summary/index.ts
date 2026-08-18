// Edge Function: signal-summary
// AI summary/callout layer (AI-04/05) per docs/north-core-metrics-spec.md.
//
// Triggered weekly by pg_cron via net.http_post (Sunday 09:00 UTC = 05:00 AST).
// For each user with a current-week signal_scores row and no signal_summaries
// row yet, builds a prompt from their inputs, calls DeepSeek, UPSERTs into
// signal_summaries.
//
// Idempotent, re-running mid-week is a no-op.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { callDeepSeekTool } from "../_shared/deepseek.ts";
import { captureServer } from "../_shared/posthog.ts";
import { stripDashes } from "../_shared/text.ts";
import {
	buildUserPrompt,
	PROMPT_VERSION,
	SUMMARY_TOOL,
	type SummaryPayload,
	SYSTEM_PROMPT,
} from "./prompt.ts";

const MODEL_NAME = "deepseek-chat";

type ScoreRow = {
	user_id: string;
	week_ending: string;
	band: "Drifting" | "Finding" | "Aligned";
	raw_score: number;
	provisional: boolean;
	inputs: {
		a: number | null;
		c: number | null;
		k: number;
		v: number;
		assigned_aligned_tasks: number;
		completed_aligned_tasks: number;
		active_days: number;
		meaningful_total: number;
		meaningful_in_focus: number;
	};
};

type ProfileRow = {
	display_name: string | null;
};

type CalloutsArray = { label: string; body: string }[];

type SummaryResult = {
	summary: string;
	callouts: CalloutsArray;
};

type RunDeps = {
	supabase: SupabaseClient;
	deepseekKey: string;
	fetcher?: typeof fetch;
};

type RunResult = {
	processed: number;
	written: number;
	skipped: number;
	errors: { user_id: string; message: string }[];
};

export async function runSummaryJob(deps: RunDeps): Promise<RunResult> {
	const fetcher = deps.fetcher ?? fetch;
	const result: RunResult = {
		processed: 0,
		written: 0,
		skipped: 0,
		errors: [],
	};

	const today = new Date();
	const dayOfWeek = today.getUTCDay(); // 0 = Sunday
	const weekEnding = new Date(today);
	if (dayOfWeek !== 0) {
		// Roll back to the most recent Sunday so re-runs mid-week target
		// the same week_ending the daily job is writing.
		weekEnding.setUTCDate(today.getUTCDate() - dayOfWeek);
	}
	const weekEndingStr = weekEnding.toISOString().slice(0, 10);

	// Find users with a current-week score but no summary yet.
	const { data: scoreRows, error: scoreErr } = await deps.supabase
		.from("signal_scores")
		.select("user_id, week_ending, band, raw_score, provisional, inputs")
		.eq("week_ending", weekEndingStr);
	if (scoreErr) throw new Error(`load signal_scores: ${scoreErr.message}`);

	for (const score of (scoreRows ?? []) as ScoreRow[]) {
		result.processed += 1;
		try {
			const { data: existing } = await deps.supabase
				.from("signal_summaries")
				.select("user_id")
				.eq("user_id", score.user_id)
				.eq("week_ending", weekEndingStr)
				.maybeSingle();
			if (existing) {
				result.skipped += 1;
				continue;
			}

			const payload = await buildPayload(deps.supabase, score);
			const summary = await callDeepSeek(payload, deps.deepseekKey, fetcher);

			const { error: upErr } = await deps.supabase
				.from("signal_summaries")
				.upsert(
					{
						user_id: score.user_id,
						week_ending: weekEndingStr,
						summary_text: stripDashes(summary.summary),
						callouts: summary.callouts.map((c) => ({
							...c,
							label: stripDashes(c.label),
							body: stripDashes(c.body),
						})),
						model_name: MODEL_NAME,
						prompt_version: PROMPT_VERSION,
					},
					{ onConflict: "user_id,week_ending" },
				);
			if (upErr) throw new Error(`upsert: ${upErr.message}`);
			result.written += 1;
			// Fire analytics. Best-effort; never raise to the caller (DEC-19).
			await captureServer("signal_summary_generated", score.user_id, {
				week_ending: weekEndingStr,
				model: MODEL_NAME,
				prompt_version: PROMPT_VERSION,
				summary_length: summary.summary.length,
				callouts_count: summary.callouts.length,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.errors.push({ user_id: score.user_id, message });
		}
	}

	return result;
}

async function buildPayload(
	supabase: SupabaseClient,
	score: ScoreRow,
): Promise<SummaryPayload> {
	const { data: profile } = await supabase
		.from("profiles")
		.select("display_name")
		.eq("user_id", score.user_id)
		.maybeSingle<ProfileRow>();

	const { data: focusRows } = await supabase
		.from("user_focus_areas")
		.select("focus_areas(label)")
		.eq("user_id", score.user_id);
	const focusAreas = (
		(focusRows ?? []) as { focus_areas: { label: string } | null }[]
	)
		.map((r) => r.focus_areas?.label)
		.filter((l): l is string => Boolean(l));

	// Trend: compare this week's raw_score to the row from week_ending - 7.
	const prevWeek = new Date(`${score.week_ending}T00:00:00Z`);
	prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
	const prevWeekStr = prevWeek.toISOString().slice(0, 10);
	const { data: prevRow } = await supabase
		.from("signal_scores")
		.select("raw_score")
		.eq("user_id", score.user_id)
		.eq("week_ending", prevWeekStr)
		.maybeSingle<{ raw_score: number }>();
	const delta = prevRow ? score.raw_score - prevRow.raw_score : 0;
	const trend: "climbing" | "holding" | "easing" =
		delta > 2 ? "climbing" : delta < -2 ? "easing" : "holding";

	return {
		display_name: profile?.display_name ?? null,
		focus_areas: focusAreas,
		band: score.band,
		provisional: score.provisional,
		trend,
		a_ratio: score.inputs.a,
		c_ratio: score.inputs.c,
		k_ratio: score.inputs.k,
		v_ratio: score.inputs.v,
		assigned_aligned_tasks: score.inputs.assigned_aligned_tasks,
		completed_aligned_tasks: score.inputs.completed_aligned_tasks,
		active_days: score.inputs.active_days,
		meaningful_total: score.inputs.meaningful_total,
		meaningful_in_focus: score.inputs.meaningful_in_focus,
	};
}

async function callDeepSeek(
	payload: SummaryPayload,
	deepseekKey: string,
	fetcher: typeof fetch,
): Promise<SummaryResult> {
	const result = await callDeepSeekTool(
		deepseekKey,
		MODEL_NAME,
		SYSTEM_PROMPT,
		buildUserPrompt(payload),
		SUMMARY_TOOL,
		600,
		fetcher,
	);
	const parsed = result as SummaryResult;
	if (typeof parsed.summary !== "string" || !Array.isArray(parsed.callouts)) {
		throw new Error("DeepSeek response missing summary/callouts");
	}
	return parsed;
}

// Deno entrypoint. Skip in test environments (DENO_TESTING=1 set by the test runner).
if (typeof Deno !== "undefined" && Deno.env.get("DENO_TESTING") !== "1") {
	Deno.serve(async (req: Request) => {
		const expectedSecret = Deno.env.get("SUMMARY_TRIGGER_SECRET");
		const presented = req.headers.get("x-trigger-secret");
		if (!expectedSecret || presented !== expectedSecret) {
			return new Response("forbidden", { status: 403 });
		}
		const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
		const supabaseUrl = Deno.env.get("SUPABASE_URL");
		const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
		if (!deepseekKey || !supabaseUrl || !serviceRole) {
			return new Response("missing env", { status: 500 });
		}
		const supabase = createClient(supabaseUrl, serviceRole, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		try {
			const result = await runSummaryJob({ supabase, deepseekKey });
			return new Response(JSON.stringify(result), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return new Response(JSON.stringify({ error: message }), {
				status: 500,
				headers: { "content-type": "application/json" },
			});
		}
	});
}
