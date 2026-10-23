import Openai from "openai";
import type { BaseMessages, AssistantMessage } from "../modelTypes/BaseMessage.js";
import { ResponseInput, Response } from "openai/resources/responses/responses.js";

export interface BaseProvider {
    readonly name: string;
    readonly provider: Openai;
    invoke(baseMessages: BaseMessages): Promise<AssistantMessage>;
}

export interface BaseMessageAdapter {
    toInput(messages: BaseMessages): ResponseInput;
    fromResponse(response: Response): AssistantMessage;
}
