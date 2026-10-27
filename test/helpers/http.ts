import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";

interface HttpFixture {
    status?: number;
    body: unknown;
}

export function mockHttp(t: TestContext, replies: readonly HttpFixture[]) {
    const requests: { url: string; method: string; body: ResponseCreateParamsNonStreaming }[] = [];

    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const body = JSON.parse(await request.text()) as ResponseCreateParamsNonStreaming;
        const reply = replies[requests.length];
        requests.push({ url: request.url, method: request.method, body });
        assert.ok(reply, "Unexpected HTTP request: no fixture remains");

        return new Response(JSON.stringify(reply.body), {
            status: reply.status ?? 200,
            headers: { "content-type": "application/json", "x-should-retry": "false" },
        });
    });

    return {
        requests,
        assertConsumed() {
            assert.equal(requests.length, replies.length, "Every HTTP fixture should be consumed exactly once");
        },
    };
}
