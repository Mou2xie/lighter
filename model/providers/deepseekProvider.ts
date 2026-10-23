import type { BaseProvider } from "./BaseProvider.js";
import Openai from "openai";
import type { Response, ResponseInput } from "openai/resources/responses/responses.js";
import type { BaseMessages, ToolCall } from "../modelTypes/BaseMessage.js";
import { AssistantMessage } from "../modelTypes/BaseMessage.js";

export class DeepseekProvider implements BaseProvider {
    readonly name = "deepseek" as const;
    readonly provider: Openai;

    constructor(apiKey: string) {
        this.provider = new Openai({
            baseURL: 'https://api.deepseek.com',
            apiKey,
        });
    }
}

// Adapter for converting between BaseMessages and DeepSeek messages.
export const deepseekMessageAdapter = {

    // Convert BaseMessages to DeepSeek ResponseInput.
    toInput(messages: BaseMessages): ResponseInput {

        const input: ResponseInput = [];

        for (const message of messages) {
            switch (message.role) {
                case "system":
                case "user":
                    input.push({ type: "message", role: message.role, content: message.content });
                    break;

                case "assistant": {
                    // Deal with reasoning, reasoning should be a separate item in the input array.
                    if (message.reasoning !== undefined) {
                        input.push({
                            type: "reasoning",
                            id: `rs_${input.length}`,
                            summary: [],
                            content: [{ type: "reasoning_text", text: message.reasoning }],
                        });
                    }

                    // Deal with content.
                    input.push({
                        type: "message",
                        role: message.role,
                        content: message.content,
                    });

                    // Deal with tool calls, tool calls should be separate items in the input array as well.
                    if (message.toolCalls.length > 0) {
                        for (const call of message.toolCalls) {
                            input.push({
                                type: "function_call",
                                call_id: call.callId,
                                name: call.toolName,
                                arguments: call.arguments,
                            });
                        }
                    }
                    break;
                }

                case "tool":
                    input.push({
                        type: "function_call_output",
                        call_id: message.callId,
                        output: message.isError
                            ? JSON.stringify({ isError: true, error: message.toolOutput })
                            : message.toolOutput,
                    });
                    break;
            }
        }
        return input;
    },

    // Convert DeepSeek Response to AssistantMessage.
    fromResponse(response: Response): AssistantMessage {
        
    },
};
