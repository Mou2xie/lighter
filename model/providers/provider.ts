import type { BaseMessages, AssistantMessage, } from "../../core/messages.js";
import type { ToolSpec } from "../../core/tool.js";

export interface Provider {
    readonly name: string;
    // In real implementation, a client property should be included to hold the actual client instance for the provider (e.g., OpenAI client, DeepSeek client, etc.). 

    invoke(messages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage>;
}

