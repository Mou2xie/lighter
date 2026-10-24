import type { Provider } from "./providers/provider.js";
import type { BaseMessages } from "./types/messages.js";
import { AssistantMessage } from "./types/messages.js";

export class Model {
    readonly provider: Provider;
    constructor(provider: Provider) {
        this.provider = provider;
    }

    async invoke(baseMessages: BaseMessages): Promise<AssistantMessage> {
        return await this.provider.invoke(baseMessages);
    }
}
