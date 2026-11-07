import Anthropic, { type AnthropicError } from "@anthropic-ai/sdk";
import type { ContentBlock, ContentBlockParam, Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { AssistantMessage, type BaseMessages, type ToolCall } from "../core/messages.js";
import { ModelError, type ModelErrorCode } from "../model/errors.js";
import type { Provider, ProviderRequest, ProviderStreamEvent } from "./provider.js";

export interface ClaudeProviderOptions {
    /** Claude requires max_tokens on every request. Defaults to 8192. */
    maxOutputTokens?: number;
    thinking?: MessageCreateParamsNonStreaming["thinking"];
}

type InputBlock = ContentBlockParam;
type InputMessage = { role: "user" | "assistant"; content: InputBlock[] };

export class ClaudeProvider implements Provider {
    readonly name = "claude" as const;
    private readonly client: Anthropic;
    private readonly options: ClaudeProviderOptions;

    constructor(apiKey: string, private readonly modelID: string, options: ClaudeProviderOptions = {}) {
        this.client = new Anthropic({ apiKey });
        this.options = structuredClone(options);
        const maxTokens = options.maxOutputTokens ?? 8192;
        if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
            throw new ModelError("Claude maxOutputTokens must be a positive integer.", "invalid_request");
        }
        if (options.thinking?.type === "enabled" && (
            !Number.isSafeInteger(options.thinking.budget_tokens) ||
            options.thinking.budget_tokens < 1024 || options.thinking.budget_tokens >= maxTokens
        )) {
            throw new ModelError("Claude thinking budget_tokens must be at least 1024 and less than maxOutputTokens.", "invalid_request");
        }
    }

    private toClaudeRequest(request: ProviderRequest): MessageCreateParamsNonStreaming {
        return {
            model: this.modelID,
            max_tokens: this.options.maxOutputTokens ?? 8192,
            ...this.toInput(request.messages),
            tools: (request.toolSpecs ?? []).map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: { ...tool.parameters, type: "object" },
                strict: tool.strict,
            })),
            ...(this.options.thinking ? { thinking: this.options.thinking } : {}),
        };
    }

    async invoke(request: ProviderRequest): Promise<AssistantMessage> {
        try {
            const response = await this.client.messages.create(this.toClaudeRequest(request));
            this.checkStopReason(response.stop_reason);
            return this.fromContent(response.content);
        } catch (error) {
            if (error instanceof Anthropic.AnthropicError) throw this.toModelError(error);
            throw error;
        }
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
        try {
            const stream = this.client.messages.stream(this.toClaudeRequest(request));
            try {
                let completed = false;
                for await (const event of stream) {
                    if (event.type === "message_stop") completed = true;
                    if (event.type !== "content_block_delta") continue;
                    if (event.delta.type === "text_delta") {
                        yield { type: "text_delta", text: event.delta.text };
                    } else if (event.delta.type === "thinking_delta") {
                        yield { type: "reasoning_delta", text: event.delta.thinking };
                    }
                }
                if (!completed) throw new ModelError("Claude streaming response ended without message_stop.", "bad_response");
                const response = await stream.finalMessage();
                this.checkStopReason(response.stop_reason);
                yield { type: "message", message: this.fromContent(response.content) };
            } finally {
                stream.abort();
            }
        } catch (error) {
            if (error instanceof Anthropic.AnthropicError) throw this.toModelError(error);
            throw error;
        }
    }

    private checkStopReason(reason: Message["stop_reason"]): void {
        switch (reason) {
            case "end_turn":
            case "tool_use":
            case "stop_sequence":
            case "refusal": return;
            default:
                throw new ModelError(`Claude generation did not complete: ${reason ?? "missing stop reason"}.`, "bad_response", {
                    responseStatus: reason ?? undefined,
                });
        }
    }

    private toModelError(error: AnthropicError): ModelError {
        let code: ModelErrorCode = "bad_response";
        if (error instanceof Anthropic.APIUserAbortError) {
            code = "aborted";
        } else if (error instanceof Anthropic.APIConnectionError) {
            code = "network_error";
        } else if (error instanceof Anthropic.APIError) {
            // SSE errors have no HTTP status, but retain the API error type.
            const type = error.type;
            if (error.status === 401 || error.status === 403 || type === "authentication_error" || type === "permission_error") code = "auth_error";
            else if (error.status === 429 || type === "rate_limit_error") code = "rate_limit";
            else if ((error.status !== undefined && error.status >= 500) || type === "overloaded_error" || type === "api_error") code = "server_error";
            else if ((error.status !== undefined && error.status >= 400) || type === "invalid_request_error" || type === "not_found_error") code = "invalid_request";
        }
        return new ModelError(`Claude request failed: ${error.message}`, code, {
            httpStatus: error instanceof Anthropic.APIError ? error.status : undefined,
        });
    }

    private toInput(history: BaseMessages): { system?: string; messages: InputMessage[] } {
        const system: string[] = [];
        const messages: InputMessage[] = [];
        const append = (role: InputMessage["role"], content: InputBlock[]) => {
            if (content.length === 0) return;
            const previous = messages.at(-1);
            if (previous?.role === role) previous.content.push(...content);
            else messages.push({ role, content });
        };

        for (const message of history) {
            switch (message.role) {
                case "system":
                    system.push(message.content);
                    break;
                case "user":
                    append("user", [{ type: "text", text: message.content }]);
                    break;
                case "assistant": {
                    const native = message instanceof ClaudeAssistantMessage ? message.replayContent() : undefined;
                    if (native) { append("assistant", native); break; }
                    // Displayed reasoning alone cannot reconstruct a signed thinking block.
                    const blocks: InputBlock[] = [];
                    if (message.content) blocks.push({ type: "text", text: message.content });
                    for (const call of message.toolCalls) {
                        let input: unknown;
                        try { input = JSON.parse(call.arguments); }
                        catch { throw new ModelError(`Invalid Claude tool arguments for ${call.toolName}.`, "invalid_request"); }
                        if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ModelError(`Claude tool arguments for ${call.toolName} must be an object.`, "invalid_request");
                        blocks.push({ type: "tool_use", id: call.callId, name: call.toolName, input });
                    }
                    append("assistant", blocks);
                    break;
                }
                case "tool":
                    append("user", [{
                        type: "tool_result", tool_use_id: message.callId,
                        content: message.toolOutput, is_error: message.isError,
                    }]);
                    break;
            }
        }
        return { ...(system.length ? { system: system.join("\n\n") } : {}), messages };
    }

    private fromContent(blocks: ContentBlock[]): AssistantMessage {
        let content = "";
        let reasoning: string | undefined;
        const toolCalls: ToolCall[] = [];
        for (const block of blocks) {
            switch (block.type) {
                case "text": content += block.text; break;
                case "thinking": reasoning = (reasoning ?? "") + block.thinking; break;
                case "tool_use":
                    toolCalls.push({ callId: block.id, toolName: block.name, arguments: JSON.stringify(block.input) });
                    break;
                case "redacted_thinking": break;
                default:
                    throw new ModelError(`Unsupported Claude content block: ${block.type}`, "bad_response");
            }
        }
        return new ClaudeAssistantMessage(content, { reasoning, toolCalls }, blocks);
    }
}

// Retain signed and redacted thinking blocks for tool-result replay without
// changing AssistantMessage or holding conversation state in the provider.
class ClaudeAssistantMessage extends AssistantMessage {
    private readonly nativeContent: ContentBlockParam[];
    private readonly originalToolCalls: string;
    private readonly originalContent: string;
    private readonly originalReasoning?: string;

    constructor(content: string, options: { reasoning?: string; toolCalls: ToolCall[] }, blocks: ContentBlockParam[]) {
        super(content, options);
        this.nativeContent = structuredClone(blocks);
        this.originalContent = content;
        this.originalReasoning = options.reasoning;
        this.originalToolCalls = JSON.stringify(options.toolCalls);
    }

    replayContent(): ContentBlockParam[] | undefined {
        if (this.content === this.originalContent && this.reasoning === this.originalReasoning &&
            JSON.stringify(this.toolCalls) === this.originalToolCalls) return structuredClone(this.nativeContent);
        return undefined;
    }
}


// Claude model input example:
/*
 * Documentation: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
 * Thinking: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
 * Illustrative input with fictional text, IDs, and signature placeholders.
 * Placeholders are not valid signatures and cannot be sent to the API.
 * This is the return value of toInput(history), spread into messages.create().
 * toClaudeRequest() also supplies model, max_tokens (8192 by default), tools, and
 * configured thinking options. Define get_weather using a top-level input_schema.
 * For this example, assume thinking is enabled on a model supporting signed blocks.
 *
 * Scenario: Toronto weather has been checked; the user now asks about London.
 * The previous tool-calling reply is an unchanged ClaudeAssistantMessage, so its
 * native thinking/signature, text, and tool_use blocks are replayed in order.
 * The final Toronto reply here is a plain AssistantMessage.
 * System messages become the top-level system string, joined with blank lines.
 *
 * input:
 * {
 *     "system": "Please respond in English.",
 *     "messages": [
 *         {
 *             "role": "user",
 *             "content": [
 *                 {
 *                     "type": "text",
 *                     "text": "What is the weather in Toronto?"
 *                 }
 *             ]
 *         },
 *         {
 *             "role": "assistant",
 *             "content": [
 *                 {
 *                     "type": "thinking",
 *                     "thinking": "I need to check the weather in Toronto next.",
 *                     "signature": "illustrative-signature-1"
 *                 },
 *                 {
 *                     "type": "text",
 *                     "text": "I will check the weather in Toronto."
 *                 },
 *                 {
 *                     "type": "tool_use",
 *                     "id": "toolu_weather_1",
 *                     "name": "get_weather",
 *                     "input": {
 *                         "city": "Toronto"
 *                     }
 *                 }
 *             ]
 *         },
 *         {
 *             "role": "user",
 *             "content": [
 *                 {
 *                     "type": "tool_result",
 *                     "tool_use_id": "toolu_weather_1",
 *                     "content": "Sunny, 15°C",
 *                     "is_error": false
 *                 }
 *             ]
 *         },
 *         {
 *             "role": "assistant",
 *             "content": [
 *                 {
 *                     "type": "text",
 *                     "text": "It is sunny and 15°C in Toronto."
 *                 }
 *             ]
 *         },
 *         {
 *             "role": "user",
 *             "content": [
 *                 {
 *                     "type": "text",
 *                     "text": "What about London?"
 *                 }
 *             ]
 *         }
 *     ]
 * }
 *
 * tool_use.input is an object, parsed from the shared tool call's arguments string.
 * tool_result.tool_use_id matches tool_use.id; results belong to a user message.
 * Tool failures use is_error: true, with the tool's error text in content.
 * Consecutive messages with the same role are merged into one content array.
 * A replaced/cloned reply or changed content/reasoning/tool calls loses native replay;
 * displayed reasoning alone cannot recreate a signed thinking block.
 */

// Claude response example:
/*
 * Documentation: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
 * Illustrative non-streaming response to "What about London?" for the input above.
 * Model, usage, and unrelated fields are omitted; this is not a full Message fixture.
 * The thinking signature below is a fictional placeholder, not usable API data.
 *
 * response:
 * {
 *     "id": "msg_weather_2",
 *     "type": "message",
 *     "role": "assistant",
 *     "stop_reason": "tool_use",
 *     "stop_sequence": null,
 *     "content": [
 *         {
 *             "type": "thinking",
 *             "thinking": "I need to check the weather in London next.",
 *             "signature": "illustrative-signature-2"
 *         },
 *         {
 *             "type": "text",
 *             "text": "I will check the weather in London.",
 *             "citations": null
 *         },
 *         {
 *             "type": "tool_use",
 *             "id": "toolu_weather_2",
 *             "name": "get_weather",
 *             "input": {
 *                 "city": "London"
 *             },
 *             "caller": {
 *                 "type": "direct"
 *             }
 *         }
 *     ]
 * }
 *
 * After checkStopReason(response.stop_reason), invoke() calls fromContent(response.content).
 * Expected shared fields of the returned ClaudeAssistantMessage:
 * new AssistantMessage("I will check the weather in London.", {
 *     reasoning: "I need to check the weather in London next.",
 *     toolCalls: [{
 *         callId: "toolu_weather_2", // Use tool_use.id, not response.id (msg_weather_2).
 *         toolName: "get_weather",
 *         arguments: '{"city":"London"}', // JSON.stringify(tool_use.input).
 *     }],
 * });
 *
 * The returned subclass retains a copy of the native blocks for later tool-result replay.
 * text blocks form content; thinking blocks form reasoning; tool_use blocks form toolCalls.
 * redacted_thinking blocks are retained for replay without becoming displayed reasoning.
 * A reply may omit thinking or tool calls; a tool call may have no text.
 * stop_reason: "tool_use" requests execution, followed by a tool_result user message.
 * Normal completion commonly uses "end_turn"; max_tokens is rejected as incomplete.
 */
