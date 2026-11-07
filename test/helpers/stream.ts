import type { BaseMessages } from "../../core/messages.js";
import type { ToolSpec } from "../../core/tool.js";
import type { Provider, ProviderRequest, ProviderStreamEvent } from "../../providers/provider.js";

export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of source) items.push(item);
    return items;
}

// Finite scripts fail immediately on unexpected follow-up requests. Generator
// factories allow tests to pause, fail midway, and observe iterator cleanup.
export class ScriptedStreamProvider implements Provider {
    readonly name = "scripted-stream";
    readonly requests: { messages: BaseMessages; tools: ToolSpec[] }[] = [];
    closed = 0;

    constructor(private readonly turns: (() => AsyncGenerator<ProviderStreamEvent>)[]) {}

    async invoke(): Promise<never> {
        throw new Error("A streaming test must not call invoke");
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
        const turn = this.turns[this.requests.length];
        this.requests.push({ messages: structuredClone(request.messages), tools: structuredClone(request.toolSpecs ?? []) });
        if (!turn) throw new Error("Unexpected extra stream request");
        try {
            yield* turn();
        } finally {
            this.closed++;
        }
    }
}

export function events(...items: ProviderStreamEvent[]) {
    return async function* () { yield* items; };
}

// Use real SSE frames through the SDK, rather than mocking provider internals.
export function sse(...items: { type: string; [key: string]: unknown }[]): string {
    return items.map((item, index) => `event: ${item.type}\ndata: ${JSON.stringify({ sequence_number: index, ...item })}\n\n`).join("")
        + "data: [DONE]\n\n";
}
