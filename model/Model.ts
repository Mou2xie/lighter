import Openai from "openai";
import type { BaseMessages } from "./modelTypes/BaseMessage.js";
import { AssistantMessage } from "./modelTypes/BaseMessage.js";
import { deepseekMessageAdapter } from "./providers/DeepseekProvider.js";

interface modelConfig {
    provider: Openai;
    modelID: string;

}

export class Model {
    provider: Openai;
    modelID: string;

    constructor(config: modelConfig) {
        this.provider = config.provider;
        this.modelID = config.modelID;
    }

    async invoke(baseMessages: BaseMessages): Promise<AssistantMessage> {
        const response = await this.provider.responses.create({
            model: this.modelID,
            input: deepseekMessageAdapter.toInput(baseMessages),
        });
        return deepseekMessageAdapter.fromResponse(response);
    }
}

