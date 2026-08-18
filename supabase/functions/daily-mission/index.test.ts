// Tests for the daily-mission Edge Function.
// Run: deno test --allow-env supabase/functions/daily-mission/index.test.ts

import { assertEquals, assertMatch, assertThrows } from "jsr:@std/assert";
import { todayInAST } from "./index.ts";
import { buildUserPrompt, parseAndValidate } from "./prompt.ts";
import { pickTemplate } from "./templates.ts";

// ── pickTemplate ──────────────────────────────────────────────────────

Deno.test("pickTemplate returns a valid template for each known focus area", () => {
	const focusAreas = ["craft", "venture", "mind", "people", "money", "learn"];
	const date = "2026-06-03";
	for (const fa of focusAreas) {
		const tmpl = pickTemplate(fa, date);
		assertEquals(typeof tmpl.title, "string");
		assertEquals(typeof tmpl.intent, "string");
		assertEquals(tmpl.tasks.length, 3);
		for (const task of tmpl.tasks) {
			assertEquals(typeof task.label, "string");
			assertEquals(typeof task.kind, "string");
			assertEquals(typeof task.estimate_label, "string");
		}
	}
});

Deno.test("pickTemplate returns a template for an unknown focus area", () => {
	const tmpl = pickTemplate("unknown-area", "2026-06-03");
	assertEquals(typeof tmpl.title, "string");
	assertEquals(tmpl.tasks.length, 3);
});

Deno.test("pickTemplate rotates by day, different dates give different templates for large sets", () => {
	// craft has 3 templates; dates 3 apart should differ.
	const t1 = pickTemplate("craft", "2026-06-01");
	const t2 = pickTemplate("craft", "2026-06-02");
	const t3 = pickTemplate("craft", "2026-06-03");
	// Not all three should be identical, rotation is working.
	const titles = new Set([t1.title, t2.title, t3.title]);
	assertEquals(titles.size > 1, true);
});

// ── buildUserPrompt ───────────────────────────────────────────────────

Deno.test("buildUserPrompt includes focus areas and time budget", () => {
	const prompt = buildUserPrompt({
		display_name: "Zoe",
		focus_area_labels: ["Craft & Mastery", "Deeper learning"],
		time_budget_label: "30 minutes",
		season_label: "I know what I want but I'm stuck.",
		avoid_note: "Starting too many things at once",
		day_of_week: "Tuesday",
	});
	assertMatch(prompt, /Craft & Mastery/);
	assertMatch(prompt, /30 minutes/);
	assertMatch(prompt, /Starting too many things/);
	assertMatch(prompt, /Tuesday/);
});

Deno.test("buildUserPrompt omits avoid line when avoid_note is null", () => {
	const prompt = buildUserPrompt({
		display_name: null,
		focus_area_labels: ["Craft & Mastery"],
		time_budget_label: null,
		season_label: null,
		avoid_note: null,
		day_of_week: "Monday",
	});
	assertEquals(prompt.includes("Avoid:"), false);
});

// ── parseAndValidate ──────────────────────────────────────────────────

const VALID_RESPONSE = JSON.stringify({
	mission: {
		title: "Sharpen one skill deliberately today",
		intent: "Mastery compounds.",
	},
	tasks: [
		{ label: "Identify the gap", kind: "reflect", estimate_label: "10 min" },
		{ label: "Practice the gap", kind: "do", estimate_label: "30 min" },
		{ label: "Note what shifted", kind: "write", estimate_label: "5 min" },
	],
});

Deno.test("parseAndValidate accepts a valid DeepSeek response", () => {
	const result = parseAndValidate(VALID_RESPONSE);
	assertEquals(result.title, "Sharpen one skill deliberately today");
	assertEquals(result.tasks.length, 3);
	assertEquals(result.tasks[0].kind, "reflect");
});

Deno.test("parseAndValidate throws when tasks count is wrong", () => {
	const bad = JSON.stringify({
		mission: { title: "Test", intent: "Test" },
		tasks: [{ label: "Only one", kind: "do", estimate_label: "10 min" }],
	});
	assertThrows(() => parseAndValidate(bad), Error, "exactly 3 tasks");
});

Deno.test("parseAndValidate throws when mission fields are missing", () => {
	const bad = JSON.stringify({
		mission: { title: "Missing intent" },
		tasks: [],
	});
	assertThrows(
		() => parseAndValidate(bad),
		Error,
		"missing mission.title or mission.intent",
	);
});

// ── todayInAST ────────────────────────────────────────────────────────

Deno.test("todayInAST returns a YYYY-MM-DD string 4 hours behind UTC", () => {
	// At 08:00 UTC, AST date is the same calendar day.
	const utc08 = new Date("2026-06-03T08:00:00Z");
	assertEquals(todayInAST(utc08), "2026-06-03");

	// At 02:00 UTC, AST is still the previous day (22:00 AST on June 2nd).
	const utc02 = new Date("2026-06-03T02:00:00Z");
	assertEquals(todayInAST(utc02), "2026-06-02");
});
