// Versioned prompt for the daily-mission Edge Function.
// Bump PROMPT_VERSION when changing wording so generated missions remain
// attributable to the version that produced them (AI-03).

export const PROMPT_VERSION = "v0.1";
export const MODEL_NAME = "deepseek-chat";

export type MissionContext = {
	display_name: string | null;
	focus_area_labels: string[]; // 1 to 3 human-readable labels
	time_budget_label: string | null; // e.g. "30 minutes"
	season_label: string | null; // one of the 4 season options
	avoid_note: string | null; // what the user wants to avoid
	day_of_week: string; // e.g. "Monday"
};

export type GeneratedTask = {
	label: string;
	kind: string;
	estimate_label: string;
};

export type GeneratedMission = {
	title: string;
	intent: string;
	tasks: [GeneratedTask, GeneratedTask, GeneratedTask];
};

export const SYSTEM_PROMPT = `You are a mission designer for North, an app helping ambitious people in the Caribbean align their daily actions with their personal direction.

Generate exactly one focused daily mission with exactly three tasks.

Rules:
- Make the mission concrete and completable within the user's stated time budget for today.
- Each task must be specific, not generic ("check your email"). It should matter for the user's stated focus.
- If they noted something to avoid, honour it. Frame the mission to sidestep that tendency.
- Tone: purposeful and calm. Never urgent, gamified, or motivational-poster.
- Task kinds: read, write, do, connect, reflect, or commit.
- Mission title: 5 to 12 words, action-oriented.
- Mission intent: one sentence explaining why this mission matters today.

Output JSON only, matching the supplied schema. Do not include the user's name in the output.`;

export function buildUserPrompt(ctx: MissionContext): string {
	const parts: string[] = [
		`Focus areas: ${ctx.focus_area_labels.length ? ctx.focus_area_labels.join(", ") : "not specified"}`,
		`Time available today: ${ctx.time_budget_label ?? "flexible"}`,
		`Life season: ${ctx.season_label ?? "not specified"}`,
	];
	if (ctx.avoid_note) {
		parts.push(`Avoid: ${ctx.avoid_note}`);
	}
	parts.push(`Day: ${ctx.day_of_week}`);
	return parts.join("\n");
}

// DeepSeek's JSON mode only guarantees valid JSON, not schema conformance
// (unlike OpenAI's json_schema strict mode), so this does the real structural
// validation the model's output must pass.
export function parseAndValidate(content: string): GeneratedMission {
	const parsed = JSON.parse(content) as {
		mission?: { title?: string; intent?: string };
		tasks?: { label?: string; kind?: string; estimate_label?: string }[];
	};

	if (
		typeof parsed.mission?.title !== "string" ||
		typeof parsed.mission?.intent !== "string"
	) {
		throw new Error(
			"DeepSeek response missing mission.title or mission.intent",
		);
	}

	if (!Array.isArray(parsed.tasks) || parsed.tasks.length !== 3) {
		throw new Error(
			`DeepSeek response must have exactly 3 tasks, got ${parsed.tasks?.length ?? 0}`,
		);
	}

	for (const [i, task] of parsed.tasks.entries()) {
		if (
			typeof task.label !== "string" ||
			typeof task.kind !== "string" ||
			typeof task.estimate_label !== "string"
		) {
			throw new Error(`Task ${i} missing label, kind, or estimate_label`);
		}
	}

	return {
		title: parsed.mission.title,
		intent: parsed.mission.intent,
		tasks: parsed.tasks as [GeneratedTask, GeneratedTask, GeneratedTask],
	};
}
