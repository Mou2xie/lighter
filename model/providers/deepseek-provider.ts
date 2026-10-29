import type { Provider } from "./provider.js";
import Openai, { type OpenAIError } from "openai";
import type { Response, ResponseInput } from "openai/resources/responses/responses.js";
import type { BaseMessages, ToolCall, ToolSpec } from "../../core/protocol.js";
import { AssistantMessage } from "../../core/protocol.js";
import { ModelError, type ModelErrorCode } from "../errors.js";

// DeepSeek's two available models: deepseek-flash and deepseek-v4-pro.
type DeepSeekModelID = "deepseek-flash" | "deepseek-v4-pro";

export class DeepSeekProvider implements Provider {
    readonly name = "deepseek" as const;
    private readonly client: Openai;
    modelID: DeepSeekModelID;

    constructor(apiKey: string, modelID: DeepSeekModelID) {
        this.client = new Openai({
            baseURL: 'https://api.deepseek.com',
            apiKey,
        });
        this.modelID = modelID;
    }

    async invoke(baseMessages: BaseMessages, toolSpecs: ToolSpec[]): Promise<AssistantMessage> {
        try {
            const response = await this.client.responses.create({
                model: this.modelID,
                input: deepseekMessageAdapter.toInput(baseMessages),
                tools: toolSpecs,
            });
            deepseekErrorAdapter.checkResponseStatus(response); // Check response status, throw ModelError for non-completed statuses.
            return deepseekMessageAdapter.fromResponse(response);
        } catch (error) {
            if (error instanceof Openai.OpenAIError) {
                throw deepseekErrorAdapter.toModelError(error);
            }
            throw error;
        }
    }
}

// Adapter for error checking and converting DeepSeek errors to ModelError.
const deepseekErrorAdapter = {

    // Check the response status and throw ModelError for non-completed statuses.
    checkResponseStatus: (response: Response): void => {
        switch (response.status) {
            case "completed":
                return;

            case "failed":
                throw new ModelError(
                    `DeepSeek generation failed: ${response.error?.message ?? "No error details provided."}`,
                    "bad_response",
                    { responseStatus: response.status },
                );

            case "incomplete":
                throw new ModelError(
                    `DeepSeek generation is incomplete: ${response.incomplete_details?.reason ?? "No reason provided."}`,
                    "bad_response",
                    { responseStatus: response.status },
                );

            case "cancelled":
                throw new ModelError("DeepSeek generation was cancelled.", "aborted", {
                    responseStatus: response.status,
                });

            default:
                throw new ModelError(`Unexpected DeepSeek response status: ${response.status}`, "bad_response", {
                    responseStatus: response.status,
                });
        }

    },

    // Convert OpenAIError to ModelError with appropriate ModelErrorCode.
    toModelError(error: OpenAIError): ModelError {
        let code: ModelErrorCode = "unknown";

        if (error instanceof Openai.APIUserAbortError) {
            code = "aborted";
        } else if (error instanceof Openai.APIConnectionError) {
            code = "network_error";
        } else if (error instanceof Openai.APIError) {
            if (error.status === 401 || error.status === 403) {
                code = "auth_error";
            } else if (error.status === 429) {
                code = "rate_limit";
            } else if (error.status !== undefined && error.status >= 500) {
                code = "server_error";
            } else if (error.status !== undefined && error.status >= 400) {
                code = "invalid_request";
            }
        }

        return new ModelError(`DeepSeek request failed: ${error.message}`, code, {
            status: error instanceof Openai.APIError ? error.status : undefined,
        });
    }
}

// Adapter for converting between BaseMessages and DeepSeek messages.
const deepseekMessageAdapter = {

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
        let reasoning: string | undefined = undefined;
        let content: string = "";
        const toolCalls: ToolCall[] = [];

        for (const item of response.output) {
            switch (item.type) {
                case "reasoning": {
                    for (const reasoningItem of item.content ?? []) {
                        if (reasoningItem.type === "reasoning_text") {
                            reasoning = (reasoning ?? "") + reasoningItem.text;

                        }
                    }
                    break;
                }

                case "message": {
                    for (const contentItem of item.content) {
                        if (contentItem.type === "output_text") {
                            content += contentItem.text;
                        }
                    }
                    break;
                }

                case "function_call": {
                    toolCalls.push({
                        callId: item.call_id,
                        toolName: item.name,
                        arguments: item.arguments,
                    });
                    break;
                }
            }
        }

        return new AssistantMessage(content, { reasoning, toolCalls });
    },
};

// Deepseek model input example:
/*
 * Documentation: https://api-docs.deepseek.com/api/create-response/
 * Illustrative input array based on the documentation, with fictional content and IDs.
 * This is the return value of toInput(messages), used in responses.create({ model, input, tools }).
 * Define available tools in the top-level tools parameter, outside input.
 * DeepSeek Responses API is stateless; send the full conversation history with each request.
 *
 * Scenario: Toronto weather has been checked, and the user now asks about London.
 * reasoning, assistant text, and function_call come from the same internal AssistantMessage.
 * function_call_output comes from a ToolMessage created after executing the tool.
 * id identifies an item; call_id pairs a tool call with its result.
 * Keep arguments as a JSON string; output contains the tool result as a string.
 * summary: [] and reasoning.id satisfy SDK types; DeepSeek reads the text in content.
 *
 * input:
 * [
 *     { "type": "message", "role": "system", "content": "Please respond in English." },
 *     { "type": "message", "role": "user", "content": "What is the weather in Toronto?" },
 *     {
 *         "type": "reasoning",
 *         "id": "rs_2",
 *         "summary": [],
 *         "content": [
 *             { "type": "reasoning_text", "text": "I need to check the weather in Toronto." }
 *         ]
 *     },
 *     { "type": "message", "role": "assistant", "content": "I will check the weather in Toronto." },
 *     {
 *         "type": "function_call",
 *         "call_id": "call_weather_1",
 *         "name": "get_weather",
 *         "arguments": "{\"city\":\"Toronto\"}"
 *     },
 *     {
 *         "type": "function_call_output",
 *         "call_id": "call_weather_1",
 *         "output": "Sunny, 15°C"
 *     },
 *     { "type": "message", "role": "assistant", "content": "It is sunny and 15°C in Toronto." },
 *     { "type": "message", "role": "user", "content": "What about London?" }
 * ]
 *
 * For tool failures, this adapter wraps output in a string such as:
 * "{\"isError\":true,\"error\":\"Weather query timed out\"}"
 * This is a project convention, not a built-in API isError field.
 */

// Deepseek response example:
/*
 * Documentation: https://api-docs.deepseek.com/api/create-response/
 * Illustrative non-streaming response to "What about London?", omitting usage and other fields.
 * This is a response excerpt, not a complete SDK Response fixture or a real API record.
 * The text is split into two parts to demonstrate iteration; the service need not split it this way.
 *
 * response:
 * {
 *     "id": "resp_002",
 *     "object": "response",
 *     "model": "deepseek-flash",
 *     "status": "completed",
 *     "error": null,
 *     "incomplete_details": null,
 *     "output": [
 *         {
 *             "type": "reasoning",
 *             "id": "rs_002",
 *             "status": "completed",
 *             "summary": [],
 *             "content": [
 *                 { "type": "reasoning_text", "text": "I need to check the weather in London next." }
 *             ]
 *         },
 *         {
 *             "type": "message",
 *             "id": "msg_002",
 *             "status": "completed",
 *             "role": "assistant",
 *             "content": [
 *                 { "type": "output_text", "text": "I will check ", "annotations": [] },
 *                 { "type": "output_text", "text": "the weather in London.", "annotations": [] }
 *             ]
 *         },
 *         {
 *             "type": "function_call",
 *             "id": "fc_002",
 *             "status": "completed",
 *             "call_id": "call_weather_2",
 *             "name": "get_weather",
 *             "arguments": "{\"city\":\"London\"}"
 *         }
 *     ]
 * }
 *
 * Expected result of fromResponse(response):
 * new AssistantMessage("I will check the weather in London.", {
 *     reasoning: "I need to check the weather in London next.",
 *     toolCalls: [{
 *         callId: "call_weather_2", // Use call_id, not item.id (fc_002).
 *         toolName: "get_weather",
 *         arguments: '{"city":"London"}',
 *     }],
 * });
 *
 * A normal reply may omit reasoning or function_call; a tool call may have no assistant text.
 * Join content parts in order, and collect every function_call item.
 * Create ToolMessage after executing a tool, rather than from this response.
 * completed means generation finished; toolCalls still require execution and another request.
 * Do not treat failed or incomplete as a complete reply; truncation may report max_output_tokens.
 */
