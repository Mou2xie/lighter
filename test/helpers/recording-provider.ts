import type { AssistantMessage, BaseMessages } from "../../core/messages.js";
import type { ToolSpec } from "../../core/tool.js";
import type { Provider } from "../../model/providers/provider.js";

export class RecordingProvider implements Provider {
    readonly name: string;
    readonly requests: { messages: BaseMessages; tools: ToolSpec[] }[] = [];

    constructor(private readonly wrapped: Provider) {
        this.name = wrapped.name;
    }

    async invoke(messages: BaseMessages, tools: ToolSpec[]): Promise<AssistantMessage> {
        // Agent appends to its local context after invoke returns. Snapshot
        // each request so later steps cannot change the recorded observation.
        this.requests.push({ messages: structuredClone(messages), tools: structuredClone(tools) });
        return this.wrapped.invoke(messages, tools);
    }
}
