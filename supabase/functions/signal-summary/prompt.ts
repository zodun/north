// Versioned prompt for the signal-summary Edge Function.
// Bump PROMPT_VERSION when changing wording so old summaries remain
// queryable by version for A/B comparison.

export const PROMPT_VERSION = "v0.1";

export const SYSTEM_PROMPT = `You write one paragraph (50 to 90 words) of a calm weekly summary for a user of North, an app helping people align their daily actions with their stated direction.

Tone: calm, observational, never gamified. Never use streak-panic ("don't lose your streak"), urgency, or numeric scores in the summary text. Reference the user's focus areas concretely when relevant. The summary should help the user feel seen, not measured.

You may also emit 0 to 2 short callouts highlighting a single concrete observation (e.g., "Deep-work block held two days running" or "Saved three things on craft this week"). Callouts should be one short label and a one-sentence body.

Output JSON only, matching the supplied schema. Do not include the user's band label or raw score in the summary text, the UI shows those separately.`;

export type SummaryPayload = {
	display_name: string | null;
	focus_areas: string[];
	band: "Drifting" | "Finding" | "Aligned";
	provisional: boolean;
	trend: "climbing" | "holding" | "easing";
	a_ratio: number | null;
	c_ratio: number | null;
	k_ratio: number;
	v_ratio: number;
	assigned_aligned_tasks: number;
	completed_aligned_tasks: number;
	active_days: number;
	meaningful_total: number;
	meaningful_in_focus: number;
};

export function buildUserPrompt(p: SummaryPayload): string {
	return [
		`Focus areas: ${p.focus_areas.length ? p.focus_areas.join(", ") : "(none chosen yet)"}`,
		`Band: ${p.band}${p.provisional ? " (provisional)" : ""}`,
		`Trend vs. last week: ${p.trend}`,
		`Action on intent: ${p.completed_aligned_tasks}/${p.assigned_aligned_tasks} aligned tasks done (ratio ${fmt(p.a_ratio)})`,
		`Engagement coherence: ${p.meaningful_in_focus}/${p.meaningful_total} meaningful in-focus engagements (ratio ${fmt(p.c_ratio)})`,
		`Consistency: ${p.active_days}/7 active days (ratio ${fmt(p.k_ratio)})`,
		`Avoidance penalty: ${fmt(p.v_ratio)}`,
		`Name: ${p.display_name ?? "(unknown)"}`,
	].join("\n");
}

function fmt(n: number | null): string {
	if (n === null || Number.isNaN(n)) return "n/a";
	return n.toFixed(2);
}

// Tool schema, forced via tool_choice so the model returns the summary as a
// structured function call instead of free text.
export const SUMMARY_TOOL = {
	name: "weekly_summary",
	description: "Record the weekly summary and callouts.",
	input_schema: {
		type: "object",
		properties: {
			summary: {
				type: "string",
				description:
					"50 to 90 word calm weekly summary; no numeric score, no band name.",
			},
			callouts: {
				type: "array",
				maxItems: 2,
				items: {
					type: "object",
					properties: {
						label: { type: "string" },
						body: { type: "string" },
					},
					required: ["label", "body"],
					additionalProperties: false,
				},
			},
		},
		required: ["summary", "callouts"],
		additionalProperties: false,
	},
} as const;
