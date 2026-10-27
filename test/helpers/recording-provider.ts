import type { AssistantMessage, BaseMessages, ToolSpec } from "../../core/protocol.js";
import type { Provider } from "../../model/providers/provider.js";

export class RecordingProvider implements Provider {
    readonly name: string;
    readonly requests: { messages: BaseMessages; tools: ToolSpec[] }[] = [];

    constructor(private readonly wrapped: Provider) {
        this.name = wrapped.name;
    }

    async invoke(messages: BaseMessages, tools: ToolSpec[]): Promise<AssistantMessage> {
        // Agent mutates its history after invoke returns, so retain the input
        // as it was at request time rather than a reference to that history.
        this.requests.push({ messages: structuredClone(messages), tools: structuredClone(tools) });
        return this.wrapped.invoke(messages, tools);
    }
}
