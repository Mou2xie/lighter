import assert from "node:assert/strict";
import type { AgentLoopResult } from "../../agent/agent.js";
import type { BaseMessages } from "../../core/protocol.js";

// Assertions validate the public run result; they do not repair failures or
// adapt rejected runs into successful test outcomes.
type FailedRunResult = Extract<AgentLoopResult, { status: "failed" }>;

export function assertCompletedRun(result: AgentLoopResult): BaseMessages {
    assert.ok(result.status === "completed", "Expected a completed run");
    assert.ok(Array.isArray(result.addedMessages));
    return result.addedMessages;
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
