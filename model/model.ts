import type { Provider } from "./providers/provider.js";
import type { BaseMessages, AssistantMessage } from "../core/messages.js";
import type { ToolSpec } from "../core/tool.js";

export class Model {
    readonly provider: Provider;

    constructor(provider: Provider) {
        this.provider = provider;
    }

    async invoke(messages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage> {
        return await this.provider.invoke(messages, toolSpecs);
    }
}
