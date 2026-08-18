// Deno test for the PostHog server-event helper (DEC-19).
// Run from supabase/functions/signal-summary:
//   deno task test

import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";

import { captureServer } from "./posthog.ts";

Deno.env.set("DENO_TESTING", "1");

function stubFetch() {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const fn = ((url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return Promise.resolve(new Response("ok", { status: 200 }));
	}) as unknown as typeof fetch;
	return { fn, calls };
}

Deno.test("captureServer · no-op when apiKey is empty", async () => {
	const stub = stubFetch();
	const fired = await captureServer("test", "user-1", undefined, {
		apiKey: "",
		fetcher: stub.fn,
	});
	assertEquals(fired, false);
	assertEquals(stub.calls.length, 0);
});

Deno.test("captureServer · posts to PostHog endpoint with required fields", async () => {
	const stub = stubFetch();
	const fired = await captureServer(
		"signal_summary_generated",
		"user-abc",
		{ week_ending: "2026-05-24", model: "deepseek-chat" },
		{ apiKey: "phc_test", host: "https://eu.i.posthog.com", fetcher: stub.fn },
	);
	assertEquals(fired, true);
	assertEquals(stub.calls.length, 1);
	const call = stub.calls[0]!;
	assertEquals(call.url, "https://eu.i.posthog.com/i/v0/e/");
	assertEquals(call.init?.method, "POST");
	const body = JSON.parse(
		typeof call.init?.body === "string" ? call.init.body : "{}",
	);
	assertEquals(body.api_key, "phc_test");
	assertEquals(body.event, "signal_summary_generated");
	assertEquals(body.distinct_id, "user-abc");
	assertEquals(body.properties.week_ending, "2026-05-24");
	assertEquals(body.properties.model, "deepseek-chat");
	assertEquals(body.properties.source, "edge-function");
	assertEquals(typeof body.timestamp, "string");
});

Deno.test("captureServer · swallows network errors", async () => {
	const failingFetch = ((_url: string | URL | Request) => {
		return Promise.reject(new Error("network down"));
	}) as unknown as typeof fetch;
	const fired = await captureServer("test", "user-1", undefined, {
		apiKey: "phc_test",
		fetcher: failingFetch,
	});
	// fired = false because the request raised; helper returns false
	// instead of propagating the error.
	assertEquals(fired, false);
});
