import type { BaseProvider } from "./providers/BaseProvider.js";
import type { BaseMessages } from "./modelTypes/BaseMessage.js";
import { AssistantMessage } from "./modelTypes/BaseMessage.js";

export class Model {
    readonly provider: BaseProvider;
    constructor(provider: BaseProvider) {
        this.provider = provider;
    }

    async invoke(baseMessages: BaseMessages): Promise<AssistantMessage> {
        return await this.provider.invoke(baseMessages);
    }
}
