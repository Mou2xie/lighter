import * as z from "zod";
import { Tool } from "../../core/protocol.js";

// Compile-only checks, included by pnpm typecheck. Never execute this function.
function checkToolInference() {
    const tool = new Tool({
        name: "addition",
        description: "Add two numbers",
        parametersZodSchema: z.strictObject({ a: z.number(), b: z.number() }),
        func: args => {
            const a: number = args.a;
            const b: number = args.b;
            // @ts-expect-error numeric arguments must not silently degrade to any
            const text: string = args.a;
            // @ts-expect-error fields absent from the schema must not be available
            const missing = args.missing;
            void text;
            void missing;
            return a + b;
        },
    });

    // The execution boundary intentionally accepts unvalidated input.
    const untrusted: unknown = { a: "invalid", b: 2 };
    void tool.execute(untrusted, { callId: "type-check-only" });
}

void checkToolInference;
