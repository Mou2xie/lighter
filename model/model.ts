import type { Provider, ProviderRequest, ProviderStreamEvent } from "./providers/provider.js";
import type { AssistantMessage } from "../core/messages.js";
import type { AfterModelHook, BeforeModelHook } from "../core/hooks.js";

export type ModelRequest = ProviderRequest;

export class Model {
    readonly provider: Provider;

    constructor(provider: Provider) {
        this.provider = provider;
    }

    async invoke(modelRequest: ModelRequest, hooks?: { beforeModel?: BeforeModelHook, afterModel?: AfterModelHook }): Promise<AssistantMessage> {

        hooks?.beforeModel && (modelRequest = await hooks.beforeModel.execute(modelRequest));
        let response = await this.provider.invoke(modelRequest);
        hooks?.afterModel && (response = await hooks.afterModel.execute(response));
        return response
    }

    async *stream(modelRequest: ModelRequest, hooks?: { beforeModel?: BeforeModelHook, afterModel?: AfterModelHook }): AsyncGenerator<ProviderStreamEvent> {
        if (hooks?.beforeModel) {
            modelRequest = await hooks.beforeModel.execute(modelRequest);
        }
        const responseStream = this.provider.stream(modelRequest);
        for await (let chunk of responseStream) {
            if (chunk.type === "message") {
                hooks?.afterModel && (chunk.message = await hooks.afterModel.execute(chunk.message));
            }
            yield chunk;
        }
    }
}


