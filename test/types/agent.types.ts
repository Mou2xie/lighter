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

// Stream results are yielded events, so for-await consumers must distinguish
// the final result from provider deltas using the current public union.
async function inspectStream(agent: Agent) {
    const stream: AsyncGenerator<import("../../agent/agent.js").AgentStreamEvent> = agent.stream([]);
    for await (const event of stream) {
        if ("status" in event) {
            const result: AgentResult = event;
            void result;
        } else if (event.type === "message") {
            const message: import("../../core/messages.js").AssistantMessage = event.message;
            void message;
        } else {
            const text: string = event.text;
            const kind: "reasoning_delta" | "text_delta" = event.type;
            void text;
            void kind;
        }
    }
}
void inspectStream;
