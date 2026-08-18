// POST /api/task-suggestion
// Turns a generic monthly-mission task ("learn an AI topic", "practice a skill")
// into ONE concrete, current, actionable suggestion via DeepSeek. Returns a small
// JSON object the Mission page renders inline; any failure (no API key,
// bad JSON, network) degrades gracefully to { suggestion: null } so the page
// simply shows the task title with no suggestion pill.
//
// This route is additive, it does not touch the mission query or routing.

import { type NextRequest, NextResponse } from "next/server";
import { cleanCopy } from "@/lib/text";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export const runtime = "nodejs";

type Suggestion = {
	suggestion: string | null;
	resource?: string | null;
	source?: string | null;
	sourceUrl?: string | null;
	duration?: string | null;
	why?: string | null;
};

const NONE: Suggestion = { suggestion: null };

// Pull the first balanced JSON object out of the model's text (tolerates code
// fences or stray prose around it).
function parseSuggestion(text: string): Suggestion {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) return NONE;
	try {
		const data = JSON.parse(text.slice(start, end + 1)) as Suggestion;
		if (typeof data.suggestion !== "string" || !data.suggestion.trim()) {
			return NONE;
		}
		// Keep the pill dash-free (URLs are left untouched).
		return {
			...data,
			suggestion: cleanCopy(data.suggestion),
			resource: cleanCopy(data.resource),
			source: cleanCopy(data.source),
			duration: cleanCopy(data.duration),
			why: cleanCopy(data.why),
		};
	} catch {
		return NONE;
	}
}

export async function POST(request: NextRequest) {
	// No key configured → no suggestion (page falls back to the plain title).
	const apiKey = process.env.DEEPSEEK_API_KEY;
	if (!apiKey) return NextResponse.json(NONE);

	let body: {
		task?: unknown;
		goal?: unknown;
		focusAreas?: unknown;
		week?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(NONE);
	}

	const task = typeof body.task === "string" ? body.task.trim() : "";
	if (!task) return NextResponse.json(NONE);
	const goal = typeof body.goal === "string" ? body.goal : "";
	const focusAreas = Array.isArray(body.focusAreas)
		? (body.focusAreas as unknown[]).filter(
				(x): x is string => typeof x === "string",
			)
		: [];
	const week = typeof body.week === "number" ? body.week : 1;

	try {
		const res = await fetch(DEEPSEEK_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				// Model explicitly chosen for this lightweight suggestion task.
				model: "deepseek-chat",
				max_tokens: 400,
				messages: [
					{
						role: "user",
						content: `You are North, an AI direction coach for young Caribbean professionals aged 18-30.

The user has this goal: "${goal}"
Their focus areas are: ${focusAreas.join(", ") || "not specified"}
They are on week ${week} of their plan.
Their current task is: "${task}"

This task is generic. Give ONE specific, actionable suggestion to make it concrete.

Respond in this exact JSON format only:
{
  "suggestion": "specific action they should take",
  "resource": "specific resource name (article/video/course/tool)",
  "source": "platform or publication name",
  "sourceUrl": "real URL if you know it, null if not",
  "duration": "estimated time e.g. 20 min",
  "why": "one sentence why this fits their goal"
}

Examples of good suggestions:
- For "learn an AI topic": suggest "Watch Andrej Karpathy's Neural Networks Zero to Hero Episode 1 on YouTube"
- For "practice a skill": suggest a specific exercise with the exact technique to use
- For "read about entrepreneurship": suggest a specific article title and publication

Be specific, current, and relevant to Caribbean/global young professionals.
Only respond with the JSON object.`,
					},
				],
			}),
		});

		if (!res.ok) return NextResponse.json(NONE);

		const data = (await res.json()) as {
			choices?: { message?: { content?: string } }[];
		};
		const text = data.choices?.[0]?.message?.content ?? "";

		return NextResponse.json(parseSuggestion(text));
	} catch {
		return NextResponse.json(NONE);
	}
}
