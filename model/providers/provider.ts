import type { BaseMessages, AssistantMessage } from "../../core/messages.js";
import type { ToolSpec } from "../../core/tool.js";

export interface ProviderRequest {
    messages: BaseMessages;
    toolSpecs?: ToolSpec[];
}

export type ProviderStreamEvent = {
    type: "reasoning_delta",
    text: string,
} | {
    type: "text_delta",
    text: string,
} | {
    type: "message",
    message: AssistantMessage,
}

export interface Provider {
    readonly name: string;
    // In real implementation, a client property should be included to hold the actual client instance for the provider (e.g., OpenAI client, DeepSeek client, etc.). 
    invoke(providerRequest: ProviderRequest): Promise<AssistantMessage>;
    stream(providerRequest: ProviderRequest): AsyncGenerator<ProviderStreamEvent>;
}

