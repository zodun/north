// Versioned prompt for review-opportunity: AI moderation + light enrichment of
// user-submitted opportunities before they reach the public Opportunities feed.
// Bump PROMPT_VERSION when changing wording.

export const PROMPT_VERSION = "v1";
export const MODEL_NAME = "deepseek-chat";

export type OpportunityInput = {
	title: string;
	org: string;
	opportunity_type?: string | null;
	location?: string | null;
	deadline?: string | null;
	description?: string | null;
	external_url: string;
};

export type ReviewDecision = "publish" | "reject" | "needs_human";

export type ReviewResult = {
	decision: ReviewDecision;
	reason: string;
	why: string;
	tags: string[];
};

export const SYSTEM_PROMPT = `You are the gatekeeper for North's Opportunities feed. North is a calm, direction-over-hype app for young people building their futures, especially in its launch market. People submit opportunities (jobs, internships, scholarships, accelerators, grants, community programmes, events, creator programmes) and you decide whether each one can go on the public feed.

Choose exactly one outcome:
- "publish": a real, specific, legitimate opportunity that is clearly relevant and safe for this audience, from a plausible real organization, with a real-looking link and enough detail to be useful.
- "reject": spam, scams, pyramid or MLM schemes, pay-to-apply exploitation, adult, illegal, hateful or misleading content, advertising of unrelated products, gibberish, or anything clearly fake or unsafe.
- "needs_human": plausibly legitimate but you cannot be confident, an organization you cannot place, too vague to judge, borderline relevance, or missing key details. When you are genuinely unsure, choose this, never "publish".

Be conservative. Only "publish" when you are confident it is legitimate, useful, and safe. Only "reject" when it is clearly bad. Everything in between is "needs_human". You cannot open the link, so judge from the text and the plausibility of the organization and the URL.

Always return:
- "reason": one short, plain sentence explaining the decision. On a reject it is shown to the person who submitted it, so be kind and specific, never harsh.
- "why": for "publish" only, one calm sentence (about 16 words max) on why this matters to someone, direction over hype, no exclamation marks, no sales language. Empty string otherwise.
- "tags": for "publish" only, 2 to 4 short lowercase tags (for example: remote, scholarship, design, paid, africa). Empty array otherwise.

Never use dashes in any text you write. Keep everything calm and plain.`;

export function buildUserPrompt(o: OpportunityInput): string {
	return [
		`Title: ${o.title}`,
		`Organization: ${o.org}`,
		o.opportunity_type ? `Type: ${o.opportunity_type}` : "",
		o.location ? `Location: ${o.location}` : "",
		o.deadline ? `Deadline: ${o.deadline}` : "",
		o.description
			? `Description: ${o.description}`
			: "Description: (none provided)",
		`Link: ${o.external_url}`,
	]
		.filter(Boolean)
		.join("\n");
}

// Tool schema, forced via tool_choice so the model returns the verdict as a
// structured function call instead of free text.
export const REVIEW_TOOL = {
	name: "opportunity_review",
	description: "Record the moderation decision for a submitted opportunity.",
	input_schema: {
		type: "object",
		properties: {
			decision: {
				type: "string",
				enum: ["publish", "reject", "needs_human"],
				description:
					"publish = confident it is legitimate and safe; reject = clearly bad; needs_human = unsure.",
			},
			reason: {
				type: "string",
				description:
					"One short plain sentence explaining the decision. Shown to the submitter on reject, so be kind.",
			},
			why: {
				type: "string",
				description:
					"Publish only: one calm sentence on why it matters, no hype. Empty string otherwise.",
			},
			tags: {
				type: "array",
				items: { type: "string" },
				description:
					"Publish only: 2 to 4 short lowercase tags. Empty array otherwise.",
			},
		},
		required: ["decision", "reason", "why", "tags"],
		additionalProperties: false,
	},
} as const;
