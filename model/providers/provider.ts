import Openai from "openai";
import { ResponseInput, Response } from "openai/resources/responses/responses.js";
import type { BaseMessages, AssistantMessage, ToolSpec } from "../../core/protocol.js";

// Provider template
export interface Provider {
    readonly name: string;
    readonly provider: Openai;
    invoke(baseMessages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage>;
}

// Adapter template (Coverts the BaseMessages to the provider's input format and vice versa)
export interface BaseMessageAdapter {
    toInput(messages: BaseMessages): ResponseInput;
    fromResponse(response: Response): AssistantMessage;
}
