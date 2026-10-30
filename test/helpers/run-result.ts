import assert from "node:assert/strict";
import type { AgentResult } from "../../agent/agent.js";
import type { BaseMessages } from "../../core/messages.js";

export function assertCompletedRun(result: AgentResult): BaseMessages {
    assert.equal(result.status, "completed", "Expected a completed run");
    assert.ok(Array.isArray(result.messages));
    return result.messages;
}

// AgentResult allows an optional error, but caught model failures should retain
// the original thrown value, including undefined. Callers verify its identity.
export function assertFailedRun(result: AgentResult): AgentResult {
    assert.equal(result.status, "failed", "Expected a failed run result");
    assert.ok(Array.isArray(result.messages));
    assert.ok("error" in result, "A caught model failure must expose its error");
    return result;
}
