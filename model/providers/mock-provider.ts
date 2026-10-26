import type { Provider } from "./provider.js";
import type { BaseMessages, ToolSpec } from "../../core/protocol.js";
import { AssistantMessage } from "../../core/protocol.js";


export class MockProvider implements Provider {
    readonly name = "mock" as const;
    readonly responses: AssistantMessage[];
    private responseIndex: number = 0;

    constructor(responses: AssistantMessage[]) {
        this.responses = responses;
    }
    async invoke(baseMessages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage> {
        if (this.responseIndex < this.responses.length) {
            return this.responses[this.responseIndex++];
        } else {
            throw new Error("MockProvider: no responses remaining.");
        }
    }
}