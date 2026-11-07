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
            ...claudeMessageAdapter.toInput(request.messages),
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
            claudeErrorAdapter.checkStopReason(response.stop_reason);
            return claudeMessageAdapter.fromContent(response.content);
        } catch (error) {
            if (error instanceof Anthropic.AnthropicError) throw claudeErrorAdapter.toModelError(error);
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
                claudeErrorAdapter.checkStopReason(response.stop_reason);
                yield { type: "message", message: claudeMessageAdapter.fromContent(response.content) };
            } finally {
                stream.abort();
            }
        } catch (error) {
            if (error instanceof Anthropic.AnthropicError) throw claudeErrorAdapter.toModelError(error);
            throw error;
        }
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

const claudeMessageAdapter = {
    toInput(history: BaseMessages): { system?: string; messages: InputMessage[] } {
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
    },

    fromContent(blocks: ContentBlock[]): AssistantMessage {
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
    },
};

const claudeErrorAdapter = {
    checkStopReason(reason: Message["stop_reason"]): void {
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
    },

    toModelError(error: AnthropicError): ModelError {
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
    },
};
