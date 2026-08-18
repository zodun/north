// Edge Function: plan-month (MONTH-02)
// Accepts a user's self-written monthly goal + cadence, calls DeepSeek to break
// it into a 4-week plan (milestone + daily action per week), then rewrites the
// month's mission and steps to match, marking the goal as user-authored.
//
// Auth: user JWT via Authorization header (supabase.functions.invoke sends it
// automatically). An authenticated client verifies identity and reads context;
// the service role writes the mission, steps and cadence (those rows aren't
// freely client-writable).
//
// Operator setup (once per environment):
//   supabase secrets set DEEPSEEK_API_KEY=sk-...
//   supabase functions deploy plan-month

import { createClient } from "@supabase/supabase-js";
import { corsHeaders, preflight } from "../_shared/cors.ts";

import { callDeepSeekTool } from "../_shared/deepseek.ts";
import { captureServer } from "../_shared/posthog.ts";
import { escapeHtml, sendMessage, telegramToken } from "../_shared/telegram.ts";
import { stripDashes } from "../_shared/text.ts";
import {
	buildSuggestPrompt,
	buildUserPrompt,
	DAYS_PER_WEEK,
	fallbackPlan,
	type GoalSuggestion,
	MODEL_NAME,
	PLAN_TOOL,
	type PlanResult,
	PROMPT_VERSION,
	SUGGEST_SYSTEM_PROMPT,
	SUGGEST_TOOL,
	SYSTEM_PROMPT,
} from "./prompt.ts";

const MAX_TITLE_LENGTH = 140;
const MAX_INTENT_LENGTH = 400;

type Step = {
	id: string;
	cadence: "daily" | "weekly";
	week_index: number;
	due_date: string | null;
	title: string;
	detail: string | null;
	estimate_label: string | null;
	done: boolean;
};

// The 28 days of a rolling 4-week cycle, starting at the mission's anchor date
// (monthly_missions.month_start). Mirrors ensure_monthly_mission so a custom goal
// gets the same real 4-week span as a template one, instead of the calendar month.
function cycleDays(anchor: string): string[] {
	const start = new Date(`${anchor}T00:00:00Z`);
	const days: string[] = [];
	for (let i = 0; i < 4 * DAYS_PER_WEEK; i++) {
		const d = new Date(start);
		d.setUTCDate(start.getUTCDate() + i);
		days.push(d.toISOString().slice(0, 10));
	}
	return days;
}

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
		let mode: "suggest" | "plan";
		let goalTitle = "";
		let goalIntent = "";
		let cadence: "daily" | "weekly" = "daily";
		let monthStart: string;
		try {
			const parsed = (await req.json()) as {
				mode?: unknown;
				goal_title?: unknown;
				goal_intent?: unknown;
				cadence?: unknown;
				month_start?: unknown;
			};
			if (
				typeof parsed.month_start !== "string" ||
				!/^\d{4}-\d{2}-\d{2}$/.test(parsed.month_start)
			) {
				return json({ error: "month_start is required (YYYY-MM-DD)" }, 400);
			}
			monthStart = parsed.month_start;
			mode = parsed.mode === "suggest" ? "suggest" : "plan";
			if (mode === "plan") {
				if (
					typeof parsed.goal_title !== "string" ||
					parsed.goal_title.trim().length === 0
				) {
					return json({ error: "goal_title is required" }, 400);
				}
				goalTitle = parsed.goal_title.trim().slice(0, MAX_TITLE_LENGTH);
				goalIntent =
					typeof parsed.goal_intent === "string"
						? parsed.goal_intent.trim().slice(0, MAX_INTENT_LENGTH)
						: "";
				cadence = parsed.cadence === "weekly" ? "weekly" : "daily";
			}
		} catch {
			return json({ error: "invalid JSON" }, 400);
		}

		// ── Suggest mode: propose a goal from the user's onboarding, no writes ─
		if (mode === "suggest") {
			const [focusRes, profileRes] = await Promise.all([
				userClient
					.from("user_focus_areas")
					.select("focus_areas(label)")
					.eq("user_id", user.id),
				userClient
					.from("profiles")
					.select(
						"statement_of_intent, season_label, preferred_opportunity_categories",
					)
					.eq("user_id", user.id)
					.maybeSingle<{
						statement_of_intent: string | null;
						season_label: string | null;
						preferred_opportunity_categories: string[] | null;
					}>(),
			]);

			const focusLabels = (
				(focusRes.data ?? []) as { focus_areas: { label: string } | null }[]
			)
				.map((r) => r.focus_areas?.label)
				.filter((l): l is string => Boolean(l));

			let suggestion: GoalSuggestion = { goal_title: "", goal_intent: "" };
			if (deepseekKey) {
				try {
					suggestion = (await callDeepSeekTool(
						deepseekKey,
						MODEL_NAME,
						SUGGEST_SYSTEM_PROMPT,
						buildSuggestPrompt({
							focus_areas: focusLabels,
							statement_of_intent: profileRes.data?.statement_of_intent ?? "",
							season_label: profileRes.data?.season_label ?? "",
							interests:
								profileRes.data?.preferred_opportunity_categories ?? [],
						}),
						SUGGEST_TOOL,
						512,
					)) as GoalSuggestion;
				} catch {
					// fall through to the template fallback below
				}
			}
			if (!suggestion.goal_title) {
				// Fall back to this month's seeded template goal so the field is
				// never empty even without an API key.
				const { data: m } = await userClient
					.from("monthly_missions")
					.select("goal_title")
					.eq("user_id", user.id)
					.eq("month_start", monthStart)
					.maybeSingle<{ goal_title: string }>();
				suggestion = {
					goal_title: m?.goal_title ?? "Make one meaningful step this month.",
					goal_intent: "",
				};
			}
			return json({ ok: true, suggestion });
		}

		// ── Context: focus areas + the mission row we're rewriting ───────
		const [focusRes, missionRes, profileRes] = await Promise.all([
			userClient
				.from("user_focus_areas")
				.select("focus_areas(label)")
				.eq("user_id", user.id),
			userClient
				.from("monthly_missions")
				.select("id, focus_area_id")
				.eq("user_id", user.id)
				.eq("month_start", monthStart)
				.maybeSingle<{ id: string; focus_area_id: string | null }>(),
			userClient
				.from("profiles")
				.select(
					"time_budget_label, career_stage, fields, country, telegram_chat_id, telegram_opt_in",
				)
				.eq("user_id", user.id)
				.maybeSingle<{
					time_budget_label: string | null;
					career_stage: string | null;
					fields: string[] | null;
					country: string | null;
					telegram_chat_id: string | null;
					telegram_opt_in: boolean | null;
				}>(),
		]);

		if (!missionRes.data) {
			return json({ error: "no mission for that month" }, 404);
		}
		const missionId = missionRes.data.id;
		const focusAreaId = missionRes.data.focus_area_id;
		const estimate = profileRes.data?.time_budget_label || "10 minutes";

		const focusAreas = (
			(focusRes.data ?? []) as { focus_areas: { label: string } | null }[]
		)
			.map((r) => r.focus_areas?.label)
			.filter((l): l is string => Boolean(l));

		// ── Build the plan (DeepSeek, with a deterministic fallback) ─────
		let plan: PlanResult;
		let usedAi = false;
		if (!deepseekKey) {
			plan = fallbackPlan(goalTitle);
		} else {
			try {
				const result = (await callDeepSeekTool(
					deepseekKey,
					MODEL_NAME,
					SYSTEM_PROMPT,
					buildUserPrompt({
						goal_title: goalTitle,
						goal_intent: goalIntent,
						focus_areas: focusAreas,
						career_stage: profileRes.data?.career_stage ?? undefined,
						fields: profileRes.data?.fields ?? undefined,
						region: profileRes.data?.country ?? undefined,
					}),
					PLAN_TOOL,
					2048,
				)) as PlanResult;
				if (!Array.isArray(result.weeks) || result.weeks.length !== 4) {
					throw new Error("plan did not contain 4 weeks");
				}
				if (
					result.weeks.some(
						(wk) =>
							!Array.isArray(wk.daily_actions) || wk.daily_actions.length === 0,
					)
				) {
					throw new Error("plan week missing daily_actions");
				}
				plan = result;
				usedAi = true;
			} catch {
				plan = fallbackPlan(goalTitle);
			}
		}

		// Keep all generated copy dash-free (mirrors migration 0053).
		goalTitle = stripDashes(goalTitle);
		goalIntent = stripDashes(goalIntent);
		for (const wk of plan.weeks) {
			wk.milestone = stripDashes(wk.milestone);
			wk.summary = stripDashes(wk.summary ?? "");
			wk.daily_actions = (wk.daily_actions ?? []).map(stripDashes);
		}

		// ── Rewrite mission + steps with the service role ────────────────
		const service = createClient(supabaseUrl, serviceRole, {
			auth: { persistSession: false, autoRefreshToken: false },
		});

		await service
			.from("monthly_missions")
			.update({
				goal_title: goalTitle,
				goal_intent: goalIntent || null,
				generated_by: "manual",
			})
			.eq("id", missionId);

		await service
			.from("profiles")
			.update({ mission_cadence: cadence })
			.eq("user_id", user.id);

		// Replace the whole step set so daily + weekly both reflect the new plan.
		await service
			.from("monthly_mission_steps")
			.delete()
			.eq("monthly_mission_id", missionId);

		const rows: Array<Record<string, unknown>> = [];
		// 4 weekly milestones.
		for (let w = 0; w < 4; w++) {
			rows.push({
				monthly_mission_id: missionId,
				user_id: user.id,
				cadence: "weekly",
				week_index: w,
				due_date: null,
				title: plan.weeks[w].milestone,
				detail: plan.weeks[w].summary || `Your focus for week ${w + 1}.`,
				estimate_label: "This week",
				sort_order: w,
			});
		}
		// Lay the 4-week arc across a real 28-day cycle from the mission's anchor
		// (month_start). week_index = floor(offset / 7) → exactly weeks 0..3, and
		// each day steps through that week's daily actions. Mirrors
		// ensure_monthly_mission so template and custom goals share one model: a
		// full four weeks starting at the anchor, always opening on Week 1.
		const days = cycleDays(monthStart);
		days.forEach((due, offset) => {
			const w = Math.min(3, Math.floor(offset / DAYS_PER_WEEK));
			const actions = plan.weeks[w].daily_actions;
			const within = offset % DAYS_PER_WEEK;
			const idx = Math.min(actions.length - 1, Math.max(0, within));
			const dayTask =
				actions.length > 0 ? actions[idx] : plan.weeks[w].milestone;
			rows.push({
				monthly_mission_id: missionId,
				user_id: user.id,
				cadence: "daily",
				week_index: w,
				due_date: due,
				title: dayTask,
				detail: plan.weeks[w].milestone,
				estimate_label: estimate,
				sort_order: offset,
			});
		});

		await service.from("monthly_mission_steps").insert(rows);

		// Read the steps back in the same shape the client view expects.
		const { data: steps } = await service
			.from("monthly_mission_steps")
			.select(
				"id, cadence, week_index, due_date, title, detail, estimate_label, done",
			)
			.eq("monthly_mission_id", missionId)
			.order("sort_order");

		await captureServer("monthly_goal_set", user.id, {
			month_start: monthStart,
			cadence,
			focus_area_id: focusAreaId,
			used_ai: usedAi,
			prompt_version: PROMPT_VERSION,
		});

		// Goal-set confirmation on Telegram (NOTIF-03), a one-time kickoff message
		// separate from the daily/weekly reminder cron. Only for connected,
		// opted-in users; weekly users get this week's focus, daily users get their
		// first step. Best-effort: a send failure never fails the goal-set.
		const tgChatId = profileRes.data?.telegram_chat_id;
		const tgToken = telegramToken();
		if (tgChatId && profileRes.data?.telegram_opt_in && tgToken) {
			const focus =
				cadence === "weekly"
					? `This week: ${plan.weeks[0]?.milestone ?? ""}\n${
							plan.weeks[0]?.summary ?? ""
						}`
					: `Your first step today: ${
							plan.weeks[0]?.daily_actions?.[0] ??
							plan.weeks[0]?.milestone ??
							""
						}`;
			const text =
				`🎯 Your goal is set:\n<b>${escapeHtml(goalTitle)}</b>\n\n` +
				`${escapeHtml(focus)}\n\n` +
				`I'll send your reminder here each ${cadence === "weekly" ? "week" : "morning"}. Turn it off any time in Profile.`;
			await sendMessage(tgToken, tgChatId, text);
		}

		return json({
			ok: true,
			mission: {
				id: missionId,
				goal_title: goalTitle,
				goal_intent: goalIntent || null,
				focus_area_id: focusAreaId,
				month_start: monthStart,
				generated_by: "manual",
			},
			cadence,
			steps: (steps ?? []) as Step[],
		});
	});
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...corsHeaders },
	});
}
