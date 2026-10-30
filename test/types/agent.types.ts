import type { Agent, AgentResult } from "../../agent/agent.js";
import type { BaseMessages } from "../../core/messages.js";

// Compile-only checks for the current public API. Error is optional on the
// result type; runtime tests separately check that caught failures preserve it.
function inspectResult(result: Awaited<ReturnType<Agent["run"]>>) {
    const publicResult: AgentResult = result;
    const messages: BaseMessages = publicResult.messages;
    const error: unknown = publicResult.error;
    const status: "completed" | "failed" = publicResult.status;
    void error;
    void status;
    return messages;
}

const completed: AgentResult = { status: "completed", messages: [] };
const failed: AgentResult = { status: "failed", messages: [], error: new Error("Unavailable") };
const withoutError: AgentResult = { status: "failed", messages: [] };
// @ts-expect-error Every result must contain its generated messages.
const missingMessages: AgentResult = { status: "completed" };
// @ts-expect-error Only completed and failed are supported run statuses.
const invalidStatus: AgentResult = { status: "cancelled", messages: [] };

void inspectResult;
void completed;
void failed;
void withoutError;
void missingMessages;
void invalidStatus;
