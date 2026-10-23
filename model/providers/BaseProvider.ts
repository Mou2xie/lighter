import Openai from "openai";
import type { BaseMessages, AssistantMessage } from "../modelTypes/BaseMessage.js";

export interface BaseProvider {
    readonly name: string;
    readonly provider: Openai;

    invoke(baseMessages: BaseMessages): Promise<AssistantMessage>;
}
