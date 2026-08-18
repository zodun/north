// Versioned prompt for the personalize Edge Function (AI-07, premium).
// Ranks a user's feed / opportunities against their direction and writes a
// short reason for the top picks. Items are passed as a NUMBERED list and the
// model returns indices (not ids), short integers are cheaper and the model
// can't mangle them the way it can a 36-char uuid.

export const PROMPT_VERSION = "v0.3";
export const MODEL_NAME = "deepseek-chat";

export type PersonalizeContext = {
	focus_areas: string[];
	statement_of_intent: string;
	season_label: string;
	goal_title: string;
	interests: string[];
	// Who they are, drives eligibility/relevance, not just preference.
	career_stage: string;
	fields: string[];
	country: string;
	open_to_remote: boolean;
	open_to_relocate: boolean;
	// Live evidence from the journal: what's recently moved them forward
	// (signal) and what's pulled them off course (noise). Aggregated from the
	// last several days of reflections.
	recent_signal: string[];
	recent_noise: string[];
};

export type RankingResult = {
	order: number[]; // 1-based item numbers, most relevant first
	highlights: { item: number; reason: string }[];
};

const NOUN: Record<string, string> = {
	feed: "content feed",
	opportunities: "list of opportunities",
};

export function systemPrompt(surface: string): string {
	const noun = NOUN[surface] ?? "list";
	return `You personalize a ${noun} for a user of North, an app that helps people align their daily actions with their stated direction.

You are given what the app knows about the user, who they are (their career stage, field, and where they're based, plus whether they can work remotely or relocate) and what they're working toward (their focus areas, the intent they wrote at onboarding, the season they're in, their goal this month, and the kinds of opportunities they care about), and a NUMBERED list of items.

You may also be given live evidence from the user's journal: what has recently been SIGNAL (real progress, what's working, what energized them) and what has been NOISE (drift, distraction, what pulled them off course).

Do two things:
1. order: rank EVERY item number from most to least relevant to who this user is and what they're working toward. Weigh eligibility and fit first, an item that doesn't suit their career stage, field, or location (when it can't be done remotely and they can't relocate) should rank lower even if the topic is appealing. Then use their focus, goal, and interests, not generic popularity. Treat recent signal as live momentum: lift items that build on or sustain what's recently been working for them. Treat recent noise as what's pulling them off course: don't amplify it, and gently favor items that help them counter it. Include every number exactly once.
2. highlights: for the ~8 most relevant items, write one short reason (≤14 words) speaking to the user ("Matches your … ", "Builds on your recent momentum with …", "Helps you cut the … that's been pulling you"). Be specific to them; never generic.

Only use what you're told about the user, don't invent facts. Use the tool to return your answer.`;
}

export function buildUserPrompt(
	ctx: PersonalizeContext,
	items: string[],
): string {
	const location = ctx.country
		? `${ctx.country}${
				ctx.open_to_remote && ctx.open_to_relocate
					? " (open to remote and relocating)"
					: ctx.open_to_remote
						? " (open to remote)"
						: ctx.open_to_relocate
							? " (open to relocating)"
							: " (not open to remote or relocating)"
			}`
		: "";
	const lines = [
		ctx.career_stage ? `Career stage: ${ctx.career_stage}` : "",
		ctx.fields.length ? `Field(s): ${ctx.fields.join(", ")}` : "",
		location ? `Based in: ${location}` : "",
		`Focus areas: ${ctx.focus_areas.length ? ctx.focus_areas.join(", ") : "(none chosen yet)"}`,
		ctx.goal_title ? `This month's goal: ${ctx.goal_title}` : "",
		ctx.statement_of_intent
			? `What they said they want (onboarding): ${ctx.statement_of_intent}`
			: "",
		ctx.season_label ? `Season of life: ${ctx.season_label}` : "",
		ctx.interests.length ? `Interested in: ${ctx.interests.join(", ")}` : "",
		ctx.recent_signal.length
			? `Recently signal (momentum, what's working): ${ctx.recent_signal.join("; ")}`
			: "",
		ctx.recent_noise.length
			? `Recently noise (drift, what pulled them off): ${ctx.recent_noise.join("; ")}`
			: "",
		"",
		"Items:",
		...items.map((label, i) => `${i + 1}. ${label}`),
	];
	return lines.filter((l) => l !== undefined).join("\n");
}

// Tool schema, forced via tool_choice so the model returns the ranking as a
// structured function call instead of free text.
export const RANKING_TOOL = {
	name: "ranking",
	description: "Return the personalized ordering and reasons.",
	input_schema: {
		type: "object",
		properties: {
			order: {
				type: "array",
				items: { type: "integer" },
				description:
					"Every item number, most relevant first. Each appears once.",
			},
			highlights: {
				type: "array",
				items: {
					type: "object",
					properties: {
						item: { type: "integer", description: "The item number." },
						reason: {
							type: "string",
							description:
								"One short reason (≤14 words), second person, specific to this user.",
						},
					},
					required: ["item", "reason"],
					additionalProperties: false,
				},
				description: "The top ~8 items with a one-line reason each.",
			},
		},
		required: ["order", "highlights"],
		additionalProperties: false,
	},
} as const;
