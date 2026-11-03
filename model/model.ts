import type { Provider, ProviderRequest, ProviderStreamEvent } from "./providers/provider.js";
import type { AssistantMessage } from "../core/messages.js";

export type ModelRequest = ProviderRequest;

export class Model {
    readonly provider: Provider;

    constructor(provider: Provider) {
        this.provider = provider;
    }

    async invoke(modelRequest: ModelRequest): Promise<AssistantMessage> {
        return await this.provider.invoke(modelRequest);
    }

    async *stream(modelRequest: ModelRequest): AsyncGenerator<ProviderStreamEvent> {
        const responseStream = this.provider.stream(modelRequest);
        for await (const chunk of responseStream) {
            yield chunk;
        }
    }
}