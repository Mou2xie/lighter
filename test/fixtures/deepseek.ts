import type {
    Response,
    ResponseFunctionToolCall,
    ResponseOutputMessage,
    ResponseReasoningItem,
} from "openai/resources/responses/responses.js";

// Deliberately partial wire responses: include the fields used by the SDK and
// adapter, without pretending these fixtures are complete SDK Response objects.
type WireResponse = Pick<Response,
    "id" | "object" | "created_at" | "model" | "status" | "error" | "incomplete_details" | "output"
>;

export function response(output: Response["output"], overrides: Partial<WireResponse> = {}): WireResponse {
    return {
        id: "resp_test",
        object: "response",
        created_at: 0,
        model: "deepseek-flash",
        status: "completed",
        error: null,
        incomplete_details: null,
        output,
        ...overrides,
    };
}

export function text(...parts: string[]): ResponseOutputMessage {
    return {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: parts.map(part => ({ type: "output_text", text: part, annotations: [] })),
    };
}

export function call(callId: string, name: string, args: string): ResponseFunctionToolCall {
    return {
        id: `item_${callId}`,
        type: "function_call",
        call_id: callId,
        name,
        arguments: args,
        status: "completed",
    };
}

export function reasoning(...parts: string[]): ResponseReasoningItem {
    return {
        id: "rs_test",
        type: "reasoning",
        summary: [],
        content: parts.map(part => ({ type: "reasoning_text", text: part })),
    };
}
