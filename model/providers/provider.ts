import type { BaseMessages, AssistantMessage, ToolSpec } from "../../core/protocol.js";

// Provider interface
export interface Provider {
    readonly name: string;
    // In real implementation, a client property should be included to hold the actual client instance for the provider (e.g., OpenAI client, DeepSeek client, etc.). 
    invoke(baseMessages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage>;
}

