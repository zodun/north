// Edge Function: personalize (AI-07, premium)
// Ranks a user's For You feed or Opportunities with DeepSeek and writes a short
// reason for the top picks. Premium-only (public.is_premium) and cached once
// per user per surface per day in public.user_personalization.
//
// The page passes candidate items as { id, label }; the function loads the
// user's context, asks DeepSeek to order the items (by index) + highlight the top
// ~8, then returns ranking [{ id, why }] best-first. Falls back to the original
// order on any failure, so the page never blocks on AI.
//
// Operator setup:
//   supabase secrets set DEEPSEEK_API_KEY=sk-...
//   supabase functions deploy personalize

import { createClient } from "@supabase/supabase-js";

import { corsHeaders, preflight } from "../_shared/cors.ts";
import { callDeepSeekTool } from "../_shared/deepseek.ts";
import { captureServer } from "../_shared/posthog.ts";
import {
	buildUserPrompt,
	MODEL_NAME,
	type PersonalizeContext,
	PROMPT_VERSION,
	RANKING_TOOL,
	type RankingResult,
	systemPrompt,
} from "./prompt.ts";

const MAX_ITEMS = 80;
const MAX_LABEL = 160;

type Item = { id: string; label: string };
type Ranked = { id: string; why: string };

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
		if (authErr || !user) {
			return json({ error: "unauthorized" }, 401);
		}

		// ── Parse body ───────────────────────────────────────────────────
		let surface: "feed" | "opportunities";
		let day: string;
		let items: Item[];
		try {
			const parsed = (await req.json()) as {
				surface?: unknown;
				day?: unknown;
				items?: unknown;
			};
			if (parsed.surface !== "feed" && parsed.surface !== "opportunities") {
				return json({ error: "surface must be feed|opportunities" }, 400);
			}
			if (
				typeof parsed.day !== "string" ||
				!/^\d{4}-\d{2}-\d{2}$/.test(parsed.day)
			) {
				return json({ error: "day is required (YYYY-MM-DD)" }, 400);
			}
			if (!Array.isArray(parsed.items)) {
				return json({ error: "items must be an array" }, 400);
			}
			surface = parsed.surface;
			day = parsed.day;
			items = parsed.items
				.filter(
					(i): i is Item =>
						!!i &&
						typeof (i as Item).id === "string" &&
						typeof (i as Item).label === "string",
				)
				.slice(0, MAX_ITEMS)
				.map((i) => ({ id: i.id, label: i.label.slice(0, MAX_LABEL) }));
		} catch {
			return json({ error: "invalid JSON" }, 400);
		}

		if (items.length === 0) return json({ ok: true, ranking: [] });

		// Note: no premium gate here. Free users get ranked too so the page can
		// show a one-pick preview that drives upgrades; the per-day cache below
		// bounds this to a single DeepSeek call per user per surface per day, and
		// the pages decide how much of the ranking to reveal.

		// ── Cache: one ranking per user/surface/day ──────────────────────
		const { data: cached } = await userClient
			.from("user_personalization")
			.select("ranking")
			.eq("user_id", user.id)
			.eq("surface", surface)
			.eq("day", day)
			.maybeSingle<{ ranking: Ranked[] }>();
		if (cached?.ranking) {
			return json({ ok: true, ranking: cached.ranking, cached: true });
		}

		// ── Context ──────────────────────────────────────────────────────
		const monthStart = `${day.slice(0, 7)}-01`;
		// Last 7 days of journal entries feed live signal/noise into the rank.
		const since = isoDaysBefore(day, 7);
		const [focusRes, profileRes, missionRes, reflectionRes] = await Promise.all(
			[
				userClient
					.from("user_focus_areas")
					.select("focus_areas(label)")
					.eq("user_id", user.id),
				userClient
					.from("profiles")
					.select(
						"statement_of_intent, season_label, interests, career_stage, fields, country, open_to_remote, open_to_relocate",
					)
					.eq("user_id", user.id)
					.maybeSingle<{
						statement_of_intent: string | null;
						season_label: string | null;
						interests: string[] | null;
						career_stage: string | null;
						fields: string[] | null;
						country: string | null;
						open_to_remote: boolean | null;
						open_to_relocate: boolean | null;
					}>(),
				userClient
					.from("monthly_missions")
					.select("goal_title")
					.eq("user_id", user.id)
					.eq("month_start", monthStart)
					.maybeSingle<{ goal_title: string }>(),
				userClient
					.from("user_reflections")
					.select("analysis")
					.eq("user_id", user.id)
					.gte("entry_date", since)
					.order("entry_date", { ascending: false })
					.limit(14),
			],
		);

		// Aggregate signal/noise phrases across recent reflections, most-recent
		// first; topUnique dedupes case-insensitively and caps the list.
		const recentSignal: string[] = [];
		const recentNoise: string[] = [];
		for (const row of (reflectionRes.data ?? []) as {
			analysis: { signal?: string[]; noise?: string[] } | null;
		}[]) {
			if (row.analysis?.signal) recentSignal.push(...row.analysis.signal);
			if (row.analysis?.noise) recentNoise.push(...row.analysis.noise);
		}

		const ctx: PersonalizeContext = {
			focus_areas: (
				(focusRes.data ?? []) as { focus_areas: { label: string } | null }[]
			)
				.map((r) => r.focus_areas?.label)
				.filter((l): l is string => Boolean(l)),
			statement_of_intent: profileRes.data?.statement_of_intent ?? "",
			season_label: profileRes.data?.season_label ?? "",
			goal_title: missionRes.data?.goal_title ?? "",
			interests: profileRes.data?.interests ?? [],
			career_stage: profileRes.data?.career_stage ?? "",
			fields: profileRes.data?.fields ?? [],
			country: profileRes.data?.country ?? "",
			open_to_remote: profileRes.data?.open_to_remote ?? false,
			open_to_relocate: profileRes.data?.open_to_relocate ?? false,
			recent_signal: topUnique(recentSignal, 8),
			recent_noise: topUnique(recentNoise, 8),
		};

		// ── Rank with DeepSeek (fallback = original order, uncached) ─────
		let ranking: Ranked[] | null = null;
		let usedAi = false;
		if (deepseekKey) {
			try {
				const result = (await callDeepSeekTool(
					deepseekKey,
					MODEL_NAME,
					systemPrompt(surface),
					buildUserPrompt(
						ctx,
						items.map((i) => i.label),
					),
					RANKING_TOOL,
					1200,
				)) as RankingResult;
				ranking = applyRanking(items, result);
				usedAi = true;
			} catch {
				ranking = null;
			}
		}

		if (!ranking) {
			// No AI, return original order without caching, so we retry later.
			return json({
				ok: true,
				ranking: items.map((i) => ({ id: i.id, why: "" })),
			});
		}

		// ── Cache (service role) ─────────────────────────────────────────
		const service = createClient(supabaseUrl, serviceRole, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		await service
			.from("user_personalization")
			.upsert(
				{ user_id: user.id, surface, day, ranking },
				{ onConflict: "user_id,surface,day" },
			);

		await captureServer("personalized", user.id, {
			surface,
			items: items.length,
			used_ai: usedAi,
			prompt_version: PROMPT_VERSION,
		});

		return json({ ok: true, ranking });
	});
}

// Turn the model's index ordering + highlights into ranked {id, why}. Indices
// are validated against range; any item the model dropped is appended at the
// end so nothing is lost.
function applyRanking(items: Item[], result: RankingResult): Ranked[] {
	const why = new Map<number, string>();
	for (const h of result.highlights ?? []) {
		if (Number.isInteger(h.item) && typeof h.reason === "string") {
			why.set(h.item, h.reason.trim());
		}
	}
	const seen = new Set<number>();
	const ranked: Ranked[] = [];
	for (const n of result.order ?? []) {
		if (!Number.isInteger(n) || n < 1 || n > items.length || seen.has(n))
			continue;
		seen.add(n);
		const item = items[n - 1];
		ranked.push({ id: item.id, why: why.get(n) ?? "" });
	}
	// Append anything the model omitted, in original order.
	items.forEach((item, idx) => {
		if (!seen.has(idx + 1)) ranked.push({ id: item.id, why: "" });
	});
	return ranked;
}

// "YYYY-MM-DD" n days before the given day, computed in UTC so it stays a pure
// calendar date (matches user_reflections.entry_date).
function isoDaysBefore(day: string, n: number): string {
	const ms = Date.parse(`${day}T00:00:00Z`) - n * 86_400_000;
	return new Date(ms).toISOString().slice(0, 10);
}

// Dedupe phrases case-insensitively (keeping first/most-recent casing) and cap.
function topUnique(arr: string[], max: number): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const s of arr) {
		const trimmed = s.trim();
		const key = trimmed.toLowerCase();
		if (!trimmed || seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
		if (out.length >= max) break;
	}
	return out;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...corsHeaders },
	});
}
