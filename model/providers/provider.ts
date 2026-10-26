import type { BaseMessages, AssistantMessage, ToolSpec } from "../../core/protocol.js";

// Provider template
export interface Provider {
    readonly name: string;
    invoke(baseMessages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage>;
}

