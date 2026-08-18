// Shared DeepSeek client for Edge Functions (replaces direct Anthropic/OpenAI
// calls). DeepSeek's API is OpenAI-compatible: chat completions with a
// messages array (system + user), Bearer auth, and OpenAI-style function
// calling for structured output (there's no Anthropic-style forced tool_use,
// nor a guaranteed json_schema strict mode, so structured callers force a
// single function call via tool_choice and read its arguments).
//
// Operator setup: supabase secrets set DEEPSEEK_API_KEY=sk-...

export const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export type DeepSeekTool = {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
};

// Forces a single function call and returns its parsed arguments. Mirrors the
// old Anthropic tool_use pattern: callers pass the same {name, description,
// input_schema} tool shape they used for Claude.
export async function callDeepSeekTool(
	apiKey: string,
	model: string,
	system: string,
	userContent: string,
	tool: DeepSeekTool,
	maxTokens: number,
	fetcher: typeof fetch = fetch,
): Promise<unknown> {
	const res = await fetcher(DEEPSEEK_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			max_tokens: maxTokens,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: userContent },
			],
			tools: [
				{
					type: "function",
					function: {
						name: tool.name,
						description: tool.description,
						parameters: tool.input_schema,
					},
				},
			],
			tool_choice: { type: "function", function: { name: tool.name } },
		}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
	}
	const data = (await res.json()) as {
		choices?: {
			message?: {
				tool_calls?: { function?: { arguments?: string } }[];
			};
		}[];
	};
	const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
	if (!args) throw new Error("no tool call in DeepSeek response");
	return JSON.parse(args);
}

// Plain-text completion, no structured tool call (e.g. free-form coaching copy).
export async function callDeepSeekText(
	apiKey: string,
	model: string,
	system: string,
	userContent: string,
	maxTokens: number,
	fetcher: typeof fetch = fetch,
): Promise<string> {
	const res = await fetcher(DEEPSEEK_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			max_tokens: maxTokens,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: userContent },
			],
		}),
	});
	if (!res.ok) {
		throw new Error(`DeepSeek ${res.status}`);
	}
	const data = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
	};
	return (data.choices?.[0]?.message?.content ?? "").trim();
}
