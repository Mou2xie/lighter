import type { Provider } from "./provider.js";
import type { BaseMessages, AssistantMessage } from "../../core/messages.js";
import type { ToolSpec } from "../../core/tool.js";

// Used for testing and development purposes.
export class MockProvider implements Provider {
    readonly name = "mock" as const;
    readonly responses: AssistantMessage[];
    private responseIndex: number = 0;

    constructor(responses: AssistantMessage[]) {
        this.responses = responses;
    }
    async invoke(messages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage> {
        if (this.responseIndex < this.responses.length) {
            return this.responses[this.responseIndex++];
        } else {
            throw new Error("MockProvider: no responses remaining.");
        }
    }
}