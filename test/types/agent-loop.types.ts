import type { AgentLoop, AgentLoopResult } from "../../agent/agent.js";
import type { BaseMessages } from "../../core/protocol.js";

// Compile-only assertions: the public return type must support status narrowing
// and require failure details without exposing them on completed runs.
function inspectResult(result: Awaited<ReturnType<AgentLoop["runLoop"]>>) {
    const messages: BaseMessages = result.addedMessages;
    if (result.status === "failed") {
        const failure: Extract<AgentLoopResult, { status: "failed" }> = result;
        const error: unknown = failure.error;
        void error;
    } else {
        const completed: "completed" = result.status;
        // @ts-expect-error Completed runs do not expose an error field.
        void result.error;
        void completed;
    }
    return messages;
}

const completed: AgentLoopResult = { status: "completed", addedMessages: [] };
const failed: AgentLoopResult = { status: "failed", addedMessages: [], error: undefined };
// @ts-expect-error Failed runs must contain an error field, even for throw undefined.
const missingError: AgentLoopResult = { status: "failed", addedMessages: [] };

void inspectResult;
void completed;
void failed;
void missingError;
