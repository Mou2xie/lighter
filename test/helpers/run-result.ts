import assert from "node:assert/strict";
import type { BaseMessages } from "../../core/protocol.js";

// M1 target contract, not an adapter around the production API. Tests using
// this assertion intentionally fail until AgentLoop returns failed run results.
interface FailedRunResult {
    status: "failed";
    addedMessages: BaseMessages;
    error: unknown;
}

export function assertFailedRunOutcome(outcome: PromiseSettledResult<unknown>): FailedRunResult {
    assert.ok(outcome.status === "fulfilled",
        "M1: runLoop must return a failed run result containing partial progress instead of only rejecting");
    const result: unknown = outcome.value;
    assert.ok(result !== null && typeof result === "object" && !Array.isArray(result));
    assert.ok("status" in result && result.status === "failed");
    assert.ok("addedMessages" in result && Array.isArray(result.addedMessages));
    assert.ok("error" in result, "A failed run must expose its error");
    return result as FailedRunResult;
}
