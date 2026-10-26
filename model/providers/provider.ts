import Openai from "openai";
import type { BaseMessages, AssistantMessage } from "../types/messages.js";
import { ResponseInput, Response } from "openai/resources/responses/responses.js";
import { ToolDefinition } from "../types/tool-definition.js";

// Provider template
export interface Provider {
    readonly name: string;
    readonly provider: Openai;
    invoke(baseMessages: BaseMessages, tools: ToolDefinition[]): Promise<AssistantMessage>;
}

// Adapter template (Coverts the BaseMessages to the provider's input format and vice versa)
export interface BaseMessageAdapter {
    toInput(messages: BaseMessages): ResponseInput;
    fromResponse(response: Response): AssistantMessage;
}
