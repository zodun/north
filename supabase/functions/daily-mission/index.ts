// Edge Function: daily-mission
// AI-01: Generate one daily mission + 3 tasks per onboarded user from
//        their onboarding context and focus areas.
// AI-02: Falls back to a curated template if DeepSeek fails or key is absent.
// AI-03: Cost controls, cache check before each call; logs model name,
//        prompt version, and token count to the missions row.
//
// Triggered daily by pg_cron via net.http_post (see 0019_daily_mission_cron.sql).
// Can also be called with { "user_id": "<uuid>" } to generate for one user,
// which is useful for new sign-ups who join between daily runs.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { DEEPSEEK_URL } from "../_shared/deepseek.ts";
import { captureServer } from "../_shared/posthog.ts";
import {
	buildUserPrompt,
	type GeneratedMission,
	type MissionContext,
	MODEL_NAME,
	PROMPT_VERSION,
	parseAndValidate,
	SYSTEM_PROMPT,
} from "./prompt.ts";
import { pickTemplate } from "./templates.ts";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

type RunResult = {
	processed: number;
	cached: number;
	generated: number;
	fallback: number;
	errors: { user_id: string; message: string }[];
};

type GenerateResult = {
	status: "cached" | "generated" | "fallback";
	missionId: string;
};

type RunDeps = {
	supabase: SupabaseClient;
	deepseekKey?: string;
	fetcher?: typeof fetch;
};

// ─────────────────────────────────────────────────────────────────────
// todayInAST: current calendar date in Jamaica time (UTC-4, no DST).
// Mission assignment doesn't apply the 03:59 grace cutoff, that cutoff
// is only for classifying when a task was *completed* (ast_day in 0007).
// ─────────────────────────────────────────────────────────────────────
export function todayInAST(now = new Date()): string {
	const astMs = now.getTime() - 4 * 60 * 60 * 1000;
	return new Date(astMs).toISOString().slice(0, 10);
}

function dayOfWeek(dateStr: string): string {
	const days = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];
	return days[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

// ─────────────────────────────────────────────────────────────────────
// generateDailyMission: core generation logic for one user × date.
// AI-01/02/03.
// ─────────────────────────────────────────────────────────────────────
export async function generateDailyMission(
	supabase: SupabaseClient,
	userId: string,
	missionDate: string,
	deps: { deepseekKey?: string; fetcher?: typeof fetch },
): Promise<GenerateResult> {
	// AI-03 cache: if a mission row already exists for this user × date, skip.
	const { data: existing } = await supabase
		.from("missions")
		.select("id")
		.eq("user_id", userId)
		.eq("mission_date", missionDate)
		.maybeSingle<{ id: string }>();

	if (existing) {
		return { status: "cached", missionId: existing.id };
	}

	// Load context from profiles, focus areas, and onboarding_responses.
	const ctx = await loadContext(supabase, userId, missionDate);

	// AI-01: attempt DeepSeek generation; AI-02: fall back to template.
	let mission: GeneratedMission;
	let generatedBy: "ai" | "template" = "template";
	let modelName: string | null = null;
	let promptVersion: string | null = null;
	let generationTokens: number | null = null;

	if (deps.deepseekKey) {
		try {
			const result = await callDeepSeek(
				ctx,
				deps.deepseekKey,
				deps.fetcher ?? fetch,
			);
			mission = result.mission;
			generatedBy = "ai";
			modelName = MODEL_NAME;
			promptVersion = PROMPT_VERSION;
			generationTokens = result.tokens;
		} catch {
			// AI-02: template fallback on any DeepSeek failure.
			mission = pickTemplate(ctx.focus_area_labels[0] ?? "", missionDate);
			generatedBy = "template";
		}
	} else {
		mission = pickTemplate(ctx.focus_area_labels[0] ?? "", missionDate);
		generatedBy = "template";
	}

	// Insert the mission row with AI-03 provenance.
	const { data: missionRow, error: mErr } = await supabase
		.from("missions")
		.insert({
			user_id: userId,
			mission_date: missionDate,
			title: mission.title,
			intent: mission.intent,
			generated_by: generatedBy,
			model_name: modelName,
			prompt_version: promptVersion,
			generation_tokens: generationTokens,
		})
		.select("id")
		.single<{ id: string }>();

	if (mErr || !missionRow) {
		throw new Error(`insert mission: ${mErr?.message ?? "no row returned"}`);
	}

	// Insert the 3 tasks.
	const { error: tErr } = await supabase.from("user_mission_tasks").insert(
		mission.tasks.map((task) => ({
			mission_id: missionRow.id,
			user_id: userId,
			label: task.label,
			kind: task.kind,
			estimate_label: task.estimate_label,
		})),
	);

	if (tErr) {
		throw new Error(`insert tasks: ${tErr.message}`);
	}

	return {
		status: generatedBy === "ai" ? "generated" : "fallback",
		missionId: missionRow.id,
	};
}

// ─────────────────────────────────────────────────────────────────────
// runMissionJob: process all onboarded users for a given date.
// Called by the daily cron or by the HTTP handler with no user_id.
// ─────────────────────────────────────────────────────────────────────
export async function runMissionJob(
	deps: RunDeps,
	missionDate: string,
): Promise<RunResult> {
	const result: RunResult = {
		processed: 0,
		cached: 0,
		generated: 0,
		fallback: 0,
		errors: [],
	};

	const { data: profiles, error } = await deps.supabase
		.from("profiles")
		.select("user_id")
		.not("onboarded_at", "is", null);

	if (error) throw new Error(`load profiles: ${error.message}`);

	for (const row of (profiles ?? []) as { user_id: string }[]) {
		result.processed++;
		try {
			const { status, missionId } = await generateDailyMission(
				deps.supabase,
				row.user_id,
				missionDate,
				{ deepseekKey: deps.deepseekKey, fetcher: deps.fetcher },
			);
			if (status === "cached") result.cached++;
			else if (status === "generated") result.generated++;
			else result.fallback++;

			if (status !== "cached") {
				// Best-effort analytics, never raise.
				await captureServer(
					"daily_mission_assigned",
					row.user_id,
					{
						mission_date: missionDate,
						generated_by: status,
						mission_id: missionId,
					},
					{ apiKey: deps.supabase ? undefined : undefined }, // uses Deno.env in production
				);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.errors.push({ user_id: row.user_id, message });
		}
	}

	return result;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function loadContext(
	supabase: SupabaseClient,
	userId: string,
	missionDate: string,
): Promise<MissionContext> {
	const [profileRes, focusRes] = await Promise.all([
		supabase
			.from("profiles")
			.select("display_name, time_budget_label, season_label, avoid_note")
			.eq("user_id", userId)
			.maybeSingle<{
				display_name: string | null;
				time_budget_label: string | null;
				season_label: string | null;
				avoid_note: string | null;
			}>(),
		supabase
			.from("user_focus_areas")
			.select("focus_areas(label)")
			.eq("user_id", userId),
	]);

	const profile = profileRes.data;
	const focusAreaLabels = (
		(focusRes.data ?? []) as { focus_areas: { label: string } | null }[]
	)
		.map((r) => r.focus_areas?.label)
		.filter((l): l is string => Boolean(l));

	return {
		display_name: profile?.display_name ?? null,
		focus_area_labels: focusAreaLabels,
		time_budget_label: profile?.time_budget_label ?? null,
		season_label: profile?.season_label ?? null,
		avoid_note: profile?.avoid_note ?? null,
		day_of_week: dayOfWeek(missionDate),
	};
}

async function callDeepSeek(
	ctx: MissionContext,
	deepseekKey: string,
	fetcher: typeof fetch,
): Promise<{ mission: GeneratedMission; tokens: number }> {
	const body = {
		model: MODEL_NAME,
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildUserPrompt(ctx) },
		],
		// DeepSeek's JSON mode (unlike OpenAI's json_schema) only guarantees valid
		// JSON, not schema conformance, so parseAndValidate does the real
		// structural check below.
		response_format: { type: "json_object" },
		temperature: 0.7,
		max_tokens: 500,
	};

	const res = await fetcher(DEEPSEEK_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${deepseekKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
	}

	const json = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
		usage?: { total_tokens?: number };
	};

	const content = json.choices?.[0]?.message?.content;
	if (!content) throw new Error("DeepSeek returned empty content");

	const mission = parseAndValidate(content);
	const tokens = json.usage?.total_tokens ?? 0;

	return { mission, tokens };
}

// ─────────────────────────────────────────────────────────────────────
// Deno entrypoint
// ─────────────────────────────────────────────────────────────────────

if (typeof Deno !== "undefined" && Deno.env.get("DENO_TESTING") !== "1") {
	Deno.serve(async (req: Request) => {
		const expectedSecret = Deno.env.get("MISSION_TRIGGER_SECRET");
		const presented = req.headers.get("x-trigger-secret");
		if (!expectedSecret || presented !== expectedSecret) {
			return new Response("forbidden", { status: 403 });
		}

		const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
		const supabaseUrl = Deno.env.get("SUPABASE_URL");
		const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
		if (!supabaseUrl || !serviceRole) {
			return new Response("missing env", { status: 500 });
		}

		const supabase = createClient(supabaseUrl, serviceRole, {
			auth: { persistSession: false, autoRefreshToken: false },
		});

		// Optional: process a single user if { "user_id": "..." } is in the body.
		let userId: string | null = null;
		try {
			const body = (await req.json()) as { user_id?: string };
			userId = body.user_id ?? null;
		} catch {
			// No body or non-JSON body → process all users.
		}

		const missionDate = todayInAST();

		try {
			if (userId) {
				const result = await generateDailyMission(
					supabase,
					userId,
					missionDate,
					{
						deepseekKey,
					},
				);
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}

			const result = await runMissionJob(
				{ supabase, deepseekKey },
				missionDate,
			);
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
