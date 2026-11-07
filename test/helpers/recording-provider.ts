import type { AssistantMessage, BaseMessages } from "../../core/messages.js";
import type { ToolSpec } from "../../core/tool.js";
import type { Provider, ProviderRequest, ProviderStreamEvent } from "../../providers/provider.js";

export class RecordingProvider implements Provider {
    readonly name: string;
    readonly requests: { messages: BaseMessages; tools: ToolSpec[] }[] = [];

    constructor(private readonly wrapped: Provider) {
        this.name = wrapped.name;
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
        this.requests.push({ messages: structuredClone(request.messages), tools: structuredClone(request.toolSpecs ?? []) });
        yield* this.wrapped.stream(request);
    }

    async invoke(request: ProviderRequest): Promise<AssistantMessage> {
        // Agent appends to its local context after invoke returns. Snapshot
        // each request so later steps cannot change the recorded observation.
        this.requests.push({ messages: structuredClone(request.messages), tools: structuredClone(request.toolSpecs ?? []) });
        return this.wrapped.invoke(request);
    }
}
