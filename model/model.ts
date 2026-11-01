import type { Provider } from "./providers/provider.js";
import type { BaseMessages, AssistantMessage, ModelStreamEvent } from "../core/messages.js";
import type { ToolSpec } from "../core/tool.js";

export class Model {
    readonly provider: Provider;

    constructor(provider: Provider) {
        this.provider = provider;
    }

    async invoke(messages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage> {
        return await this.provider.invoke(messages, toolSpecs);
    }

    async *stream(messages: BaseMessages, toolSpecs: ToolSpec[]): AsyncGenerator<ModelStreamEvent> {
        const responseStream = this.provider.stream(messages, toolSpecs);
        for await (const chunk of responseStream) {
            yield chunk;
        }
    }
}
