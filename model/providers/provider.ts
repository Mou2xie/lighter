import type { BaseMessages, AssistantMessage, ToolSpec } from "../../core/protocol.js";

// Provider template
export interface Provider {
    readonly name: string;
    readonly client: any; // The underlying provider instance, e.g., OpenAI, DeepSeek, etc.
    invoke(baseMessages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage>;
}

// Adapter template (Coverts the BaseMessages to the provider's input format and vice versa)
export interface BaseMessageAdapter {
    toInput(messages: BaseMessages): any;
    fromResponse(response: any): AssistantMessage;
}
