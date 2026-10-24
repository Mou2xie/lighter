import Openai from "openai";
import type { BaseMessages, AssistantMessage } from "../types/BaseMessage.js";
import { ResponseInput, Response } from "openai/resources/responses/responses.js";

// Provider template
export interface BaseProvider {
    readonly name: string;
    readonly provider: Openai;
    invoke(baseMessages: BaseMessages): Promise<AssistantMessage>;
}

// Adapter template (Coverts the BaseMessages to the provider's input format and vice versa)
export interface BaseMessageAdapter {
    toInput(messages: BaseMessages): ResponseInput;
    fromResponse(response: Response): AssistantMessage;
}
