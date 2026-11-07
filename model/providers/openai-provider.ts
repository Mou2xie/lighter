import type { Provider, ProviderStreamEvent, ProviderRequest } from "./provider.js";
import OpenAI, { type OpenAIError } from "openai";
import type { Response, ResponseInput, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import { type BaseMessages, type ToolCall, AssistantMessage } from "../../core/messages.js";
import { ModelError, type ModelErrorCode } from "../errors.js";


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

    // Converts a ProviderRequest into OpenAI's ResponseCreateParamsNonStreaming format.
    private toOpenAIRequest(providerRequest: ProviderRequest): ResponseCreateParamsNonStreaming {

        const responseCreateParamsNonStreaming: ResponseCreateParamsNonStreaming = {
            model: this.modelID,
            input: openaiMessageAdapter.toInput(providerRequest.messages),
            tools: providerRequest.toolSpecs ?? [],
            store: false,
        };

        this.options.reasoning && (responseCreateParamsNonStreaming.reasoning = this.options.reasoning);
        this.options.maxOutputTokens && (responseCreateParamsNonStreaming.max_output_tokens = this.options.maxOutputTokens);

        return responseCreateParamsNonStreaming;
    }

    async invoke(providerRequest: ProviderRequest): Promise<AssistantMessage> {
        try {
            const response = await this.client.responses.create(this.toOpenAIRequest(providerRequest));
            openaiErrorAdapter.checkResponseStatus(response);
            return openaiMessageAdapter.fromResponse(response);
        } catch (error) {
            if (error instanceof OpenAI.OpenAIError) {
                throw openaiErrorAdapter.toModelError(error);
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
                        openaiErrorAdapter.checkResponseStatus(chunk.response);
                        yield {
                            type: "message",
                            message: openaiMessageAdapter.fromResponse(chunk.response),
                        };
                        return;

                    case "response.failed":
                    case "response.incomplete":
                        openaiErrorAdapter.checkResponseStatus(chunk.response);
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
                throw openaiErrorAdapter.toModelError(error);
            }
            throw error;
        }
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

const openaiErrorAdapter = {
    checkResponseStatus(response: Response): void {
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
    },

    toModelError(error: OpenAIError): ModelError {
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
    },
};

const openaiMessageAdapter = {
    toInput(messages: BaseMessages): ResponseInput {
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
    },

    fromResponse(response: Response): AssistantMessage {
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
    },
};



