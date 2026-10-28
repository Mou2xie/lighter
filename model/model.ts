import type { Provider } from "./providers/provider.js";
import type { BaseMessages, AssistantMessage, ToolSpec } from "../core/protocol.js";

export class Model {
    readonly provider: Provider;

    constructor(provider: Provider) {
        this.provider = provider;
    }

    async invoke(baseMessages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage> {
        return await this.provider.invoke(baseMessages, toolSpecs);
    }
}
