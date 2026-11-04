import type { AgentResponse } from "../../agent/agent.js";
import type { AfterAgentHook } from "../../core/hooks.js";
import type { BaseMessages } from "../../core/messages.js";

// AfterAgentHook transforms generated messages; Agent wraps them in a response.
type AfterAgentCallback = ConstructorParameters<typeof AfterAgentHook>[0]["hookFunction"];

const replace: AfterAgentCallback = messages => {
    const generated: BaseMessages = messages;
    return generated;
};
const replaceAsync: AfterAgentCallback = async messages => messages;
const observe: AfterAgentCallback = () => {};
const observeAsync: AfterAgentCallback = async () => {};

function inspectExecution(hook: AfterAgentHook, messages: BaseMessages) {
    const pending: Promise<BaseMessages> = hook.execute(messages);
    return pending;
}

const response: AgentResponse = { status: "completed", messages: [] };
// @ts-expect-error The callback replaces messages, not the complete AgentResponse.
const invalidResponse: AfterAgentCallback = () => response;
// @ts-expect-error Async callbacks must also return messages rather than a response.
const invalidAsyncResponse: AfterAgentCallback = async () => response;

void replace;
void replaceAsync;
void observe;
void observeAsync;
void inspectExecution;
void invalidResponse;
void invalidAsyncResponse;
