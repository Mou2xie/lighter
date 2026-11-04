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
        let _modelRequest = { ...modelRequest };
        // Execute the beforeModel hook if it exists
        hooks?.beforeModel && (_modelRequest = await hooks.beforeModel.execute(_modelRequest));

        let response = await this.provider.invoke(_modelRequest);

        // Execute the afterModel hook if it exists
        hooks?.afterModel && (response = await hooks.afterModel.execute(response));

        return response
    }

    async *stream(modelRequest: ModelRequest, hooks?: { beforeModel?: BeforeModelHook, afterModel?: AfterModelHook }): AsyncGenerator<ProviderStreamEvent> {
        let _modelRequest = { ...modelRequest };
        // Execute the beforeModel hook if it exists
        hooks?.beforeModel && (_modelRequest = await hooks.beforeModel.execute(_modelRequest));

        const responseStream = this.provider.stream(_modelRequest);

        for await (let chunk of responseStream) {
            // Execute the afterModel hook if it exists and the chunk type is "message"
            if (chunk.type === "message") {
                hooks?.afterModel && (chunk.message = await hooks.afterModel.execute(chunk.message));
            }
            yield chunk;
        }
    }
}


