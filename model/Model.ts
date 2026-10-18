import Openai from "openai";

interface modelConfig {
    provider: Openai;
    modelID?: string;
    systemPrompt?: string | SystemMessage;
}

export class Model {
    provider: Openai;
    modelID: string;
    instructions: string;

    constructor(config: modelConfig) {
        this.provider = config.provider;
        this.modelID = config.modelID ?? "deepseek-flash";
        this.instructions = (typeof config.systemPrompt === "string" ? config.systemPrompt : config.systemPrompt?.content) ?? "You are a helpful assistant.";
    }

    async invoke(agentMessages: AgentMessages): Promise<AssistantMessage> {
        const response = await this.provider.responses.create({
            model: this.modelID,
            instructions: this.instructions,
            input:agentMessages
        });
        return new AssistantMessage(response.output_text);
    }
}
