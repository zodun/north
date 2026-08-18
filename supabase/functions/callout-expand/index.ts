// Edge Function: callout-expand
// Receives a signal/noise callout body and returns two short paragraphs of
// calm, specific coaching: what the pattern means for the person's direction,
// then one concrete way to build on it (signal) or reduce it (noise).
//
// Auth: user JWT via Authorization header (supabase.functions.invoke sends it
// automatically).
//
// Operator setup (once per environment):
//   supabase secrets set DEEPSEEK_API_KEY=sk-...
//   supabase functions deploy callout-expand

import { createClient } from "@supabase/supabase-js";

import { corsHeaders, preflight } from "../_shared/cors.ts";
import { callDeepSeekText } from "../_shared/deepseek.ts";
import { stripDashes } from "../_shared/text.ts";

const MODEL_NAME = "deepseek-chat";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders, "content-type": "application/json" },
	});
}

const SYSTEM_PROMPT = `You are North's direction coach for young Caribbean professionals aged 18 to 30. Your tone is calm, observational, and grounded. You never use urgency language, streak pressure, or gamification. You are never prescriptive. You never use em dashes or en dashes. Write as though speaking quietly to a thoughtful person who wants to move in the right direction.`;

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
		const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
		if (!supabaseUrl) return json({ error: "missing env" }, 500);

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
		if (authErr || !user) return json({ error: "unauthorized" }, 401);

		let body: string;
		let label: string | undefined;
		let journalBody: string | undefined;
		try {
			const parsed = (await req.json()) as {
				body?: unknown;
				label?: unknown;
				journalBody?: unknown;
			};
			if (typeof parsed.body !== "string" || !parsed.body.trim()) {
				return json({ error: "body is required" }, 400);
			}
			body = parsed.body.trim().slice(0, 500);
			label = typeof parsed.label === "string" ? parsed.label : undefined;
			journalBody =
				typeof parsed.journalBody === "string" && parsed.journalBody.trim()
					? parsed.journalBody.trim().slice(0, 1200)
					: undefined;
		} catch {
			return json({ error: "invalid JSON" }, 400);
		}

		if (!deepseekKey) {
			return json({
				expansion:
					"Small consistent patterns compound over time. Keep noticing what pulls you toward or away from your focus.",
			});
		}

		const isNoise = label?.toLowerCase().includes("noise");
		const journalContext = journalBody
			? `\n\nJournal entry this week:\n"${journalBody}"\n`
			: "";

		const directive = isNoise
			? `This is a noise pattern from the user's week. Noise is anything that grabbed their attention without serving their direction. Expound on it in two short paragraphs. First, reflect on what this really is and why it pulls at them, connecting it to their direction and what it quietly costs. Then give one concrete, specific shift they can make to reduce or avoid this exact distraction, grounded in what they actually wrote.`
			: `This is a signal pattern from the user's week. Signal is any action or habit that moved them toward their goal. Expound on it in two short paragraphs. First, reflect on what this reveals about their direction and why it matters, connecting it to real momentum toward their goal. Then give one concrete, specific way to build on and repeat this exact thing, grounded in what they actually wrote.`;

		const userPrompt = `Observation: "${body}"${journalContext}
${directive}

Plain prose only, two short paragraphs, roughly 120 to 180 words total. No bullet points, no headers, no dashes. Be specific to what the person actually wrote, not general advice. Speak to them directly.`;

		try {
			const text = await callDeepSeekText(
				deepseekKey,
				MODEL_NAME,
				SYSTEM_PROMPT,
				userPrompt,
				500,
			);
			return json({ expansion: stripDashes(text) || null });
		} catch {
			return json({ expansion: null });
		}
	});
}
