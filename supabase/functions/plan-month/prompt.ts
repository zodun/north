// Versioned prompt for the plan-month Edge Function (MONTH-02).
// Turns a user's self-written monthly goal into a concrete 4-week plan:
// one milestone per week + a distinct task for each of the 7 days that week.
// Bump PROMPT_VERSION when changing wording.

export const PROMPT_VERSION = "v0.6";
// Days planned per week (one distinct daily task each).
export const DAYS_PER_WEEK = 7;
export const MODEL_NAME = "deepseek-chat";

export type PlanPayload = {
	goal_title: string;
	goal_intent: string;
	focus_areas: string[];
	// Context for targeting tasks to the person, not generic advice.
	career_stage?: string;
	fields?: string[];
	region?: string;
};

export type PlanWeek = {
	// What to reach by the end of the week (3 to 7 words).
	milestone: string;
	// 2 to 3 sentences: what this week is about and how to approach it. The depth
	// behind the milestone, written to the user. Shown to weekly-cadence users.
	summary: string;
	// Seven distinct daily tasks, one per day, that ladder up to the milestone.
	daily_actions: string[];
};

export type PlanResult = {
	weeks: PlanWeek[]; // exactly 4, week 1 → week 4
};

export const SYSTEM_PROMPT = `You plan a single month for a user of North, an app that helps people align their daily actions with their stated direction.

You are given the goal the user wrote for this month (in their own words) and their focus areas. Turn it into ONE clear, connected path that carries them from where they are now to achieving the goal by the end of the month. Every week and every day should be an obvious next step on that path, never a loose collection of related ideas.

Shape it as a 4-week arc where each week is a phase that visibly moves them closer, and the phases connect end to end. Adapt these phases to the user's actual goal:
- Week 1, Foundation: get set up, resolve the unknowns, and make the first real progress.
- Week 2, Build: do the core work the goal depends on.
- Week 3, Push: get through the hard middle; extend, refine, and handle the messy parts.
- Week 4, Finish: complete, polish, and reach the goal.

For each week:
- "milestone": the concrete checkpoint reached by the end of that week, phrased as an outcome they could tick off (3 to 7 words). Each milestone must follow logically from the previous week's, and week 4's milestone must mean the goal is essentially achieved.
- "summary": two or three plain sentences, written to the user, that say what this week is really about and how to approach it, the reasoning and shape of the week, not a list of tasks. This is what a weekly-cadence user reads instead of the daily steps, so it must stand on its own and give them enough to act on for the whole week. Specific to their goal, calm, no hype.
- "daily_actions": exactly 7 ordered tasks, one per day, that together complete that week's milestone. They must be SEQUENTIAL, each day continues from the day before, like steps in a recipe, not seven interchangeable variations, and none may merely restate the milestone.

Each daily task is ONE concrete action the user can finish in a single sitting (10 to 20 minutes). Write each one like a coach naming the next step, never like a report of what is already done. Every task must:
- start with a verb (Write, Send, Sketch, Set up, Read, Call, List, Spend...),
- be specific and doable in one sitting,
- have a clear finish point, so they know exactly when it's done.
Avoid completed outcomes, vague goals, status updates, and business jargon.
  Bad (a status update): "Budget set. Financing options researched."
  Good: "Set a budget and research three financing options."
  Best: "Create a simple budget and save links to three financing options that fit your situation."

Every task must be TARGETED to this exact person, their field, their region, their goal, not generic advice. Name a concrete action on a concrete thing: a real platform or tool, a specific section of a document, a named type of company or contact, a particular search. Ban vague verbs used on their own ("research", "work on", "explore", "learn about", "prepare" with no object). A task should be something they could do today and tick off, and someone with a different goal could not.

By the last day, following the path step by step should leave the goal done. Stay faithful to the user's actual goal, do not redirect it. Keep the language calm, direct, and encouraging without hype. No numbering, no day or week labels inside the text, no emoji.

Output JSON only, matching the schema: exactly 4 weeks (week 1 to week 4), each with exactly 7 daily_actions ordered day 1 to day 7.`;

export function buildUserPrompt(p: PlanPayload): string {
	return [
		`This month's goal (user's words): ${p.goal_title}`,
		p.goal_intent ? `How they'll measure success: ${p.goal_intent}` : "",
		`Focus areas: ${p.focus_areas.length ? p.focus_areas.join(", ") : "(none chosen yet)"}`,
		p.fields?.length ? `Field: ${p.fields.join(", ")}` : "",
		p.career_stage ? `Career stage: ${p.career_stage}` : "",
		p.region ? `Based in: ${p.region}` : "",
		"Tailor every task to this person's field, stage, and region.",
	]
		.filter(Boolean)
		.join("\n");
}

// Tool schema, forced via tool_choice so the model returns the plan as a
// structured function call instead of free text.
export const PLAN_TOOL = {
	name: "month_plan",
	description: "Record the 4-week plan as structured data.",
	input_schema: {
		type: "object",
		properties: {
			weeks: {
				type: "array",
				minItems: 4,
				maxItems: 4,
				items: {
					type: "object",
					properties: {
						milestone: {
							type: "string",
							description:
								"The checkpoint reached by the end of this week, as a tickable outcome (3 to 7 words). Follows from the prior week; week 4 means the goal is achieved.",
						},
						summary: {
							type: "string",
							description:
								"Two or three sentences, written to the user, on what this week is about and how to approach it, the depth behind the milestone, enough for a weekly-cadence user to act on the whole week. Specific to their goal, calm, no hype.",
						},
						daily_actions: {
							type: "array",
							minItems: 7,
							maxItems: 7,
							items: {
								type: "string",
								description:
									"One sequential task for a single day, continuing from the day before. One concrete action that starts with a verb, fits in a single 10 to 20 minute sitting, and has a clear finish point. Coach naming the next step, not a report of what's done. No completed outcomes, vague goals, status updates, or jargon.",
							},
							description:
								"Exactly 7 sequential daily tasks, ordered day 1 to day 7, that together complete this week's milestone.",
						},
					},
					required: ["milestone", "summary", "daily_actions"],
					additionalProperties: false,
				},
			},
		},
		required: ["weeks"],
		additionalProperties: false,
	},
} as const;

// ── Goal suggestion ──────────────────────────────────────────────────────────
// Before the user writes anything, propose a goal from what the app already
// knows: their focus areas, the intent they wrote at onboarding, and the kinds
// of opportunities they said they were interested in.

export type SuggestPayload = {
	focus_areas: string[];
	statement_of_intent: string;
	season_label: string;
	interests: string[];
};

export type GoalSuggestion = {
	goal_title: string;
	goal_intent: string;
};

export const SUGGEST_SYSTEM_PROMPT = `You propose ONE monthly goal for a user of North, an app that helps people align their daily actions with their stated direction.

Using what the app knows about them, their focus areas, the intent they wrote during onboarding, the season they're in, and the kinds of opportunities they're interested in, suggest a single goal for THIS month that:
- is specific and concrete (something they could actually finish in a month),
- builds directly on their stated direction and interests (don't invent unrelated topics),
- is encouraging and plain, not hype.

Return:
- goal_title: the goal in one short sentence (max ~12 words), written as something they'd say about themselves.
- goal_intent: one short sentence on why it matters to them, grounded in what they told you.

Output JSON only, matching the schema.`;

export function buildSuggestPrompt(p: SuggestPayload): string {
	return [
		`Focus areas: ${p.focus_areas.length ? p.focus_areas.join(", ") : "(none chosen yet)"}`,
		p.statement_of_intent
			? `What they said they want (onboarding): ${p.statement_of_intent}`
			: "",
		p.season_label ? `Season of life: ${p.season_label}` : "",
		p.interests.length
			? `Interested in these opportunities: ${p.interests.join(", ")}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

// Tool schema, forced via tool_choice for structured output.
export const SUGGEST_TOOL = {
	name: "goal_suggestion",
	description: "Record the suggested monthly goal as structured data.",
	input_schema: {
		type: "object",
		properties: {
			goal_title: {
				type: "string",
				description: "One short sentence naming the suggested goal.",
			},
			goal_intent: {
				type: "string",
				description: "One short sentence on why it matters to them.",
			},
		},
		required: ["goal_title", "goal_intent"],
		additionalProperties: false,
	},
} as const;

// Deterministic fallback when the model is unavailable, keeps the user's goal as
// the through-line so the month is never left unplanned. Each week still gets 7
// distinct daily tasks (one per day) that move through a setup → build → review arc.
export function fallbackPlan(goalTitle: string): PlanResult {
	const goal = goalTitle.replace(/\.\s*$/, "");
	const dayTasks = (frames: ((g: string) => string)[]): string[] =>
		frames.map((f) => f(goal));
	return {
		weeks: [
			{
				milestone: "Set the foundation",
				summary: `This week is about getting set up for ${goal}. Get clear on what done looks like, surface the unknowns that could slow you down, and make your first real bit of progress so the month starts with momentum.`,
				daily_actions: dayTasks([
					(g) => `Write down exactly what done looks like for ${g}.`,
					(g) => `List the three biggest unknowns about ${g}.`,
					(g) => `Find one example or reference for ${g}.`,
					(g) => `Sketch a rough plan for ${g}.`,
					(g) => `Pick the very first step toward ${g}.`,
					(g) => `Clear 20 minutes tomorrow to start ${g}.`,
					(g) => `Review your plan for ${g} and adjust it.`,
				]),
			},
			{
				milestone: "Build the core",
				summary: `This week you do the main work ${goal} depends on. Spend your time on the few things that actually move it forward, clear obstacles as they come up, and aim to have one solid, visible piece of progress by the end of the week.`,
				daily_actions: dayTasks([
					(g) => `Do the first concrete step toward ${g}.`,
					(g) => `Spend 15 minutes building on ${g}.`,
					(g) => `Remove one obstacle in the way of ${g}.`,
					(g) => `Ask someone or look up one thing about ${g}.`,
					(g) => `Make one visible piece of progress on ${g}.`,
					(g) => `Note what is working for ${g} and keep it.`,
					(g) => `Set up next week's push on ${g}.`,
				]),
			},
			{
				milestone: "Push through the hard part",
				summary: `This is the messy middle of ${goal}, where it gets harder and easy to stall. Take on the toughest part in small pieces, get one outside perspective, and protect your progress by cutting anything that is not moving it forward.`,
				daily_actions: dayTasks([
					(g) => `Tackle the hardest part of ${g} for 20 minutes.`,
					(g) => `Keep going on ${g}, even a little.`,
					(g) => `Fix or improve one thing in ${g}.`,
					(g) => `Get feedback on ${g} from one person.`,
					(g) => `Push ${g} a step closer to finished.`,
					(g) => `Cut anything that is not moving ${g} forward.`,
					(g) => `Check ${g} against your week's milestone.`,
				]),
			},
			{
				milestone: "Finish and reach the goal",
				summary: `This week you bring ${goal} home. Complete the last pieces, polish the rough edges, and put it in front of someone so it is genuinely done rather than almost done. End by noting what you learned and what comes next.`,
				daily_actions: dayTasks([
					(g) => `Complete the next-to-last step of ${g}.`,
					(g) => `Polish one rough edge of ${g}.`,
					(g) => `Finish the core of ${g}.`,
					(g) => `Share ${g} with one person.`,
					(g) => `Tidy up and wrap ${g}.`,
					(g) => `Note what you learned doing ${g}.`,
					(g) => `Decide your next goal after ${g}.`,
				]),
			},
		],
	};
}
