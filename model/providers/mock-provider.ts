import type { Provider, ProviderStreamEvent } from "./provider.js";
import type { BaseMessages, AssistantMessage } from "../../core/messages.js";
import type { ToolSpec } from "../../core/tool.js";
import { AgentRequest } from "../../agent/agent.js";

// Used for testing and development purposes.
export class MockProvider implements Provider {
    readonly name = "mock" as const;
    readonly responses: AssistantMessage[];
    private responseIndex: number = 0;

    constructor(responses: AssistantMessage[]) {
        this.responses = responses;
    }
    async invoke(agentRequest: AgentRequest): Promise<AssistantMessage> {
        if (this.responseIndex < this.responses.length) {
            return this.responses[this.responseIndex++];
        } else {
            throw new Error("MockProvider: no responses remaining.");
        }
    }

    async *stream(agentRequest: AgentRequest): AsyncGenerator<ProviderStreamEvent> {
        const message = await this.invoke(agentRequest);
        if (this.responseIndex < this.responses.length) {
            yield { type: "message", message };
        } else {
            yield { type: "message", message };
        }
    }
}