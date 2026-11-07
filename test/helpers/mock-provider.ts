import type { Provider, ProviderRequest, ProviderStreamEvent } from "../../providers/provider.js";
import type { AssistantMessage } from "../../core/messages.js";

// Shared finite response provider for offline tests.
export class MockProvider implements Provider {
    readonly name = "mock" as const;
    readonly responses: AssistantMessage[];
    private responseIndex: number = 0;

    constructor(responses: AssistantMessage[]) {
        this.responses = responses;
    }
    async invoke(request: ProviderRequest): Promise<AssistantMessage> {
        if (this.responseIndex < this.responses.length) {
            return this.responses[this.responseIndex++];
        } else {
            throw new Error("MockProvider: no responses remaining.");
        }
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
        const message = await this.invoke(request);
        yield { type: "message", message };
    }
}
