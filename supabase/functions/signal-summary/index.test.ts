// Deno test for the signal-summary Edge Function.
// Mocks the DeepSeek fetch and a minimal supabase-js client; asserts the
// expected signal_summaries upsert is produced.
//
// Run:  cd supabase/functions/signal-summary && deno task test

import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";

import { runSummaryJob } from "./index.ts";
import { PROMPT_VERSION } from "./prompt.ts";

Deno.env.set("DENO_TESTING", "1");

type UpsertCall = {
	table: string;
	rows: Record<string, unknown> | Record<string, unknown>[];
	options: unknown;
};

function makeStubSupabase() {
	const upserts: UpsertCall[] = [];
	let summaryLookupRound = 0;

	const supabase = {
		from(table: string) {
			if (table === "signal_scores") {
				return {
					select(_cols: string) {
						return {
							eq(_col: string, _val: unknown) {
								return Promise.resolve({
									data: [
										{
											user_id: "user-abc",
											week_ending: "2026-05-24",
											band: "Finding",
											raw_score: 58,
											provisional: false,
											inputs: {
												a: 0.571,
												c: 0.611,
												k: 0.714,
												v: 0.333,
												assigned_aligned_tasks: 21,
												completed_aligned_tasks: 12,
												active_days: 5,
												meaningful_total: 18,
												meaningful_in_focus: 11,
											},
										},
									],
									error: null,
								});
							},
						};
					},
				};
			}
			if (table === "signal_summaries") {
				return {
					select(_cols: string) {
						return {
							eq(_col: string, _val: unknown) {
								return {
									eq(_col2: string, _val2: unknown) {
										return {
											maybeSingle() {
												summaryLookupRound += 1;
												return Promise.resolve({ data: null, error: null });
											},
										};
									},
								};
							},
						};
					},
					upsert(rows: Record<string, unknown>, options: unknown) {
						upserts.push({ table, rows, options });
						return Promise.resolve({ data: rows, error: null });
					},
				};
			}
			if (table === "profiles") {
				return {
					select(_cols: string) {
						return {
							eq(_col: string, _val: unknown) {
								return {
									maybeSingle() {
										return Promise.resolve({
											data: { display_name: "Jordayne" },
											error: null,
										});
									},
								};
							},
						};
					},
				};
			}
			if (table === "user_focus_areas") {
				return {
					select(_cols: string) {
						return {
							eq(_col: string, _val: unknown) {
								return Promise.resolve({
									data: [{ focus_areas: { label: "Craft & Mastery" } }],
									error: null,
								});
							},
						};
					},
				};
			}
			throw new Error(`unstubbed table: ${table}`);
		},
	};

	return {
		supabase,
		upserts,
		get summaryLookupRound() {
			return summaryLookupRound;
		},
	};
}

function makeDeepSeekStub(): typeof fetch {
	return ((
		_url: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
		// Sanity-check the prompt was constructed from real payload data.
		const user = (body.messages as { role: string; content: string }[]).find(
			(m) => m.role === "user",
		);
		if (!user || !user.content.includes("Craft & Mastery")) {
			return Promise.resolve(
				new Response("missing focus area in prompt", { status: 500 }),
			);
		}
		return Promise.resolve(
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								tool_calls: [
									{
										function: {
											name: "weekly_summary",
											arguments: JSON.stringify({
												summary:
													"You moved on craft this week, three saves and a finish in your focus area. Tasks held in rhythm.",
												callouts: [
													{
														label: "Held the deep-work block",
														body: "Two of three days last week, including Thursday.",
													},
												],
											}),
										},
									},
								],
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
	}) as unknown as typeof fetch;
}

Deno.test("runSummaryJob writes one summary per scored user", async () => {
	const stub = makeStubSupabase();
	const fetcher = makeDeepSeekStub();

	// biome-ignore lint/suspicious/noExplicitAny: stub supabase client shape
	const result = await runSummaryJob({
		supabase: stub.supabase as any,
		deepseekKey: "sk-test",
		fetcher,
	});

	assertEquals(result.processed, 1);
	assertEquals(result.written, 1);
	assertEquals(result.skipped, 0);
	assertEquals(result.errors.length, 0);

	const row = stub.upserts[0]?.rows as Record<string, unknown>;
	assertEquals(row.user_id, "user-abc");
	assertEquals(row.prompt_version, PROMPT_VERSION);
	assertEquals(row.model_name, "deepseek-chat");
	assertEquals(
		typeof row.summary_text === "string" &&
			(row.summary_text as string).length > 0,
		true,
	);
	const callouts = row.callouts as { label: string }[];
	assertEquals(callouts[0].label, "Held the deep-work block");
});
