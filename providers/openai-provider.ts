import type { Provider, ProviderStreamEvent, ProviderRequest } from "./provider.js";
import OpenAI, { type OpenAIError } from "openai";
import type { Response, ResponseInput, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import { type BaseMessages, type ToolCall, AssistantMessage } from "../core/messages.js";
import { ModelError, type ModelErrorCode } from "../model/errors.js";

type OPENAI_MODEL_ID = NonNullable<ResponseCreateParamsNonStreaming["model"]>;

export interface OpenAIProviderOptions {
    reasoning?: ResponseCreateParamsNonStreaming["reasoning"];
    maxOutputTokens?: number;
}

export class OpenAIProvider implements Provider {
    readonly name = "openai" as const;
    private readonly client: OpenAI;
    private readonly modelID: OPENAI_MODEL_ID;
    private readonly options: OpenAIProviderOptions;

    constructor(apiKey: string, modelID: OPENAI_MODEL_ID, options: OpenAIProviderOptions = {}) {
        this.client = new OpenAI({ apiKey });
        this.modelID = modelID;
        this.options = { ...options };
    }

    async invoke(providerRequest: ProviderRequest): Promise<AssistantMessage> {
        try {
            const response = await this.client.responses.create(this.toOpenAIRequest(providerRequest));
            this.checkResponseStatus(response);
            return this.fromResponse(response);
        } catch (error) {
            if (error instanceof OpenAI.OpenAIError) {
                throw this.toModelError(error);
            }
            throw error;
        }
    }

    async *stream(providerRequest: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
        try {
            const responseStream = await this.client.responses.create({
                ...this.toOpenAIRequest(providerRequest),
                stream: true,
            });

            for await (const chunk of responseStream) {
                switch (chunk.type) {
                    case "response.reasoning_summary_text.delta":
                        yield { type: "reasoning_delta", text: chunk.delta };
                        break;

                    case "response.output_text.delta":
                    case "response.refusal.delta":
                        yield { type: "text_delta", text: chunk.delta };
                        break;

                    case "response.completed":
                        this.checkResponseStatus(chunk.response);
                        yield {
                            type: "message",
                            message: this.fromResponse(chunk.response),
                        };
                        return;

                    case "response.failed":
                    case "response.incomplete":
                        this.checkResponseStatus(chunk.response);
                        break;

                    case "error":
                        throw new ModelError(
                            `OpenAI streaming error${chunk.code ? ` (${chunk.code})` : ""}: ${chunk.message}`,
                            "bad_response",
                        );
                }
            }

            throw new ModelError("OpenAI streaming response ended without a completed message.", "bad_response");
        } catch (error) {
            if (error instanceof OpenAI.OpenAIError) {
                throw this.toModelError(error);
            }
            throw error;
        }
    }

    // Converts a ProviderRequest into OpenAI's ResponseCreateParamsNonStreaming format.
    private toOpenAIRequest(providerRequest: ProviderRequest): ResponseCreateParamsNonStreaming {
        const responseCreateParamsNonStreaming: ResponseCreateParamsNonStreaming = {
            model: this.modelID,
            input: this.toInput(providerRequest.messages),
            tools: providerRequest.toolSpecs ?? [],
            store: false,
        };
        this.options.reasoning && (responseCreateParamsNonStreaming.reasoning = this.options.reasoning);
        this.options.maxOutputTokens && (responseCreateParamsNonStreaming.max_output_tokens = this.options.maxOutputTokens);

        return responseCreateParamsNonStreaming;
    }

    private checkResponseStatus(response: Response): void {
        switch (response.status) {
            case "completed":
                return;

            case "failed":
                throw new ModelError(
                    `OpenAI generation failed: ${response.error?.message ?? "No error details provided."}`,
                    "bad_response",
                    { responseStatus: response.status },
                );

            case "incomplete":
                throw new ModelError(
                    `OpenAI generation is incomplete: ${response.incomplete_details?.reason ?? "No reason provided."}`,
                    "bad_response",
                    { responseStatus: response.status },
                );

            case "cancelled":
                throw new ModelError("OpenAI generation was cancelled.", "aborted", {
                    responseStatus: response.status,
                });

            default:
                throw new ModelError(`Unexpected OpenAI response status: ${response.status}`, "bad_response", {
                    responseStatus: response.status,
                });
        }
    }

    private toModelError(error: OpenAIError): ModelError {
        let code: ModelErrorCode = "unknown";

        if (error instanceof OpenAI.APIUserAbortError) {
            code = "aborted";
        } else if (error instanceof OpenAI.APIConnectionError) {
            code = "network_error";
        } else if (error instanceof OpenAI.APIError) {
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

        return new ModelError(`OpenAI request failed: ${error.message}`, code, {
            httpStatus: error instanceof OpenAI.APIError ? error.status : undefined,
        });
    }

    // Converts BaseMessages into OpenAI's ResponseInput format, preserving reasoning and tool calls.
    private toInput(messages: BaseMessages): ResponseInput {
        const input: ResponseInput = [];

        for (const message of messages) {
            switch (message.role) {
                case "system":
                case "user":
                    input.push({ type: "message", role: message.role, content: message.content });
                    break;

                case "assistant": {
                    if (message instanceof OpenAIAssistantMessage && message.isUnchanged()) {
                        input.push(...message.openaiOutput);
                        break;
                    }

                    // Hook replacements and messages from other providers are
                    // adapted from their current fields, never stale native output.
                    // A displayed reasoning summary cannot reconstruct encrypted
                    // reasoning. Replacing/cloning a message loses native replay.
                    if (message.content !== "" || message.toolCalls.length === 0) {
                        input.push({ type: "message", role: "assistant", content: message.content });
                    }
                    for (const call of message.toolCalls) {
                        input.push({
                            type: "function_call",
                            call_id: call.callId,
                            name: call.toolName,
                            arguments: call.arguments,
                        });
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
    }

    // Converts OpenAI's Response into an AssistantMessage, extracting reasoning and tool calls.
    private fromResponse(response: Response): AssistantMessage {
        let reasoning: string | undefined;
        let content = "";
        const toolCalls: ToolCall[] = [];

        for (const item of response.output) {
            switch (item.type) {
                case "reasoning":
                    for (const part of item.summary) {
                        reasoning = (reasoning ?? "") + part.text;
                    }
                    break;

                case "message":
                    for (const part of item.content) {
                        if (part.type === "output_text") content += part.text;
                        else if (part.type === "refusal") content += part.refusal;
                    }
                    break;

                case "function_call":
                    toolCalls.push({
                        callId: item.call_id,
                        toolName: item.name,
                        arguments: item.arguments,
                    });
                    break;

                default:
                    throw new ModelError(`Unsupported OpenAI output item: ${item.type}`, "bad_response");
            }
        }

        return new OpenAIAssistantMessage(content, { reasoning, toolCalls }, response);
    }
}

/**
 * Preserves OpenAI's replayable output alongside the shared AssistantMessage fields.
 *
 * The shared fields serve Agent logic and hooks, while openaiOutput retains native
 * reasoning context, item IDs, assistant phases, and item order for later requests.
 *
 * Native output is replayed only while this instance's content and tool calls
 * remain unchanged. Modified, replaced, or deserialized messages fall back to
 * ordinary message adaptation, which does not preserve native reasoning context.
 */
class OpenAIAssistantMessage extends AssistantMessage {
    readonly openaiOutput: ResponseInput;
    private readonly originalContent: string;
    private readonly originalToolCalls: string;

    constructor(content: string, options: { reasoning?: string; toolCalls: ToolCall[] }, response: Response) {
        super(content, options);
        this.openaiOutput = toResponseInputItems(response.output);
        this.originalContent = content;
        this.originalToolCalls = JSON.stringify(options.toolCalls);
    }

    isUnchanged(): boolean {
        return this.content === this.originalContent && JSON.stringify(this.toolCalls) === this.originalToolCalls;
    }
}


// OpenAI model input example:
/*
 * Documentation: https://developers.openai.com/api/docs/guides/function-calling
 * Reasoning: https://developers.openai.com/api/docs/guides/reasoning
 * Illustrative input with fictional text, IDs, and encrypted-content placeholders.
 * Placeholders are not valid encrypted reasoning and cannot be sent to the API.
 * This is the return value of toInput(messages), passed to responses.create().
 * toOpenAIRequest() also supplies model, tools, store: false, and configured options.
 * Define get_weather in the top-level tools parameter, outside input.
 *
 * Scenario: Toronto weather has been checked; the user now asks about London.
 * The previous tool-calling reply is an unchanged OpenAIAssistantMessage, so its
 * native reasoning, message, and function_call items are replayed in order through
 * SDK toResponseInputItems(). The final Toronto reply here is a plain AssistantMessage.
 * Send full conversation history; this provider does not use previous_response_id.
 *
 * input:
 * [
 *     {
 *         "type": "message",
 *         "role": "system",
 *         "content": "Please respond in English."
 *     },
 *     {
 *         "type": "message",
 *         "role": "user",
 *         "content": "What is the weather in Toronto?"
 *     },
 *     {
 *         "type": "reasoning",
 *         "id": "rs_weather_1",
 *         "summary": [
 *             {
 *                 "type": "summary_text",
 *                 "text": "I need to check the weather in Toronto next."
 *             }
 *         ],
 *         "encrypted_content": "illustrative-encrypted-reasoning-1"
 *     },
 *     {
 *         "type": "message",
 *         "id": "msg_weather_1",
 *         "status": "completed",
 *         "role": "assistant",
 *         "content": [
 *             {
 *                 "type": "output_text",
 *                 "text": "I will check the weather in Toronto.",
 *                 "annotations": []
 *             }
 *         ]
 *     },
 *     {
 *         "type": "function_call",
 *         "id": "fc_weather_1",
 *         "status": "completed",
 *         "call_id": "call_weather_1",
 *         "name": "get_weather",
 *         "arguments": "{\"city\":\"Toronto\"}"
 *     },
 *     {
 *         "type": "function_call_output",
 *         "call_id": "call_weather_1",
 *         "output": "Sunny, 15°C"
 *     },
 *     {
 *         "type": "message",
 *         "role": "assistant",
 *         "content": "It is sunny and 15°C in Toronto."
 *     },
 *     {
 *         "type": "message",
 *         "role": "user",
 *         "content": "What about London?"
 *     }
 * ]
 *
 * call_id links a function_call to its function_call_output; id identifies an item.
 * Function arguments and tool output are strings. Failed tool output is wrapped as
 * JSON.stringify({ isError: true, error: message.toolOutput }), a project convention.
 * A reasoning summary is display text, not a replacement for encrypted reasoning.
 * If a reply is replaced/cloned or its content/tool calls change, toInput() rebuilds
 * from the current fields and does not reconstruct native reasoning items.
 */

// OpenAI response example:
/*
 * Documentation: https://developers.openai.com/api/docs/guides/function-calling
 * Illustrative non-streaming response to "What about London?" for the input above.
 * Model, usage, and unrelated fields are omitted; this is not a full Response fixture.
 * Reasoning summaries require the reasoning.summary option on a supported model.
 * Encrypted-content values below are fictional placeholders, not usable API data.
 *
 * response:
 * {
 *     "id": "resp_weather_2",
 *     "object": "response",
 *     "status": "completed",
 *     "error": null,
 *     "incomplete_details": null,
 *     "output": [
 *         {
 *             "type": "reasoning",
 *             "id": "rs_weather_2",
 *             "summary": [
 *                 {
 *                     "type": "summary_text",
 *                     "text": "I need to check the weather in London next."
 *                 }
 *             ],
 *             "encrypted_content": "illustrative-encrypted-reasoning-2"
 *         },
 *         {
 *             "type": "message",
 *             "id": "msg_weather_2",
 *             "status": "completed",
 *             "role": "assistant",
 *             "content": [
 *                 {
 *                     "type": "output_text",
 *                     "text": "I will check the weather in London.",
 *                     "annotations": []
 *                 }
 *             ]
 *         },
 *         {
 *             "type": "function_call",
 *             "id": "fc_weather_2",
 *             "status": "completed",
 *             "call_id": "call_weather_2",
 *             "name": "get_weather",
 *             "arguments": "{\"city\":\"London\"}"
 *         }
 *     ]
 * }
 *
 * Expected shared fields of fromResponse(response), an OpenAIAssistantMessage:
 * new AssistantMessage("I will check the weather in London.", {
 *     reasoning: "I need to check the weather in London next.",
 *     toolCalls: [{
 *         callId: "call_weather_2", // Use call_id, not item.id (fc_weather_2).
 *         toolName: "get_weather",
 *         arguments: '{"city":"London"}',
 *     }],
 * });
 *
 * The returned subclass also retains SDK-normalized output for subsequent requests.
 * Reasoning comes from summary[].text; output_text and refusal parts form content.
 * A reply may omit reasoning or function calls, and a tool call may have no text.
 * completed means generation finished; pending tool calls still need execution.
 * Create ToolMessage after executing the tool; it becomes function_call_output.
 * Failed/incomplete responses are rejected before fromResponse() is called.
 */
