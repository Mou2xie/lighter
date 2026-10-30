import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { Tool } from "../core/tool.js";

const additionSchema = z.strictObject({ a: z.number(), b: z.number() });

for (const asynchronous of [false, true]) {
    test(`valid arguments execute ${asynchronous ? "an asynchronous" : "a synchronous"} tool with a paired result`, async () => {
        const received: unknown[] = [];
        const add = (args: z.infer<typeof additionSchema>) => {
            received.push(args);
            return args.a + args.b;
        };
        const tool = new Tool({
            name: "addition",
            description: "Add two numbers",
            parametersZodSchema: additionSchema,
            func: asynchronous ? async args => add(args) : add,
        });

        const result = await tool.execute({ a: 11, b: 7 }, { callId: "add-1" });

        assert.deepEqual(received, [{ a: 11, b: 7 }]);
        assert.equal(result.callId, "add-1");
        assert.equal(result.toolName, "addition");
        assert.equal(result.toolOutput, "18");
        assert.equal(result.isError, false);
    });
}

const invalidArguments: [string, unknown][] = [
    ["a missing required field", { a: 1 }],
    ["a field with the wrong type", { a: "1", b: 2 }],
    ["an extra field", { a: 1, b: 2, c: 3 }],
    ["null", null],
    ["an array", [1, 2]],
    ["a string", "not an object"],
];

for (const [label, args] of invalidArguments) {
    test(`rejects ${label} without executing the tool`, async () => {
        let executions = 0;
        const tool = new Tool({
            name: "addition",
            description: "Add two numbers",
            parametersZodSchema: additionSchema,
            func: () => { executions++; return 3; },
        });

        const result = await tool.execute(args, { callId: "invalid-1" });

        assert.equal(executions, 0);
        assert.equal(result.callId, "invalid-1");
        assert.equal(result.toolName, "addition");
        assert.equal(result.isError, true);
        assert.ok(result.toolOutput.length > 0, "The model needs an explanation of the validation failure");
    });
}

test("passes Zod's validated output, including defaults, to the function", async () => {
    const tool = new Tool({
        name: "defaulted",
        description: "Use a default value",
        parametersZodSchema: z.strictObject({ value: z.number().default(5) }),
        func: ({ value }) => value * 2,
    });

    const result = await tool.execute({}, { callId: "default-1" });

    assert.equal(result.isError, false);
    assert.equal(result.toolOutput, "10");
    assert.deepEqual(tool.getSpec().parameters.required ?? [], []);
});

for (const [label, func] of [
    ["synchronous exception", () => { throw new Error("Tool unavailable"); }],
    ["asynchronous rejection", async () => { throw new Error("Tool unavailable"); }],
    ["non-Error exception", () => { throw "Tool unavailable"; }],
] as const) {
    test(`returns a paired error result for ${label}`, async () => {
        const tool = new Tool({
            name: "broken",
            description: "Throw a test error",
            parametersZodSchema: z.strictObject({}),
            func,
        });

        const result = await tool.execute({}, { callId: "broken-1" });

        assert.equal(result.callId, "broken-1");
        assert.equal(result.toolName, "broken");
        assert.equal(result.isError, true);
        assert.match(result.toolOutput, /Tool unavailable/);
    });
}

test("preserves text tool output without adding JSON quotes", async () => {
    const tool = new Tool({ name: "text", description: "Return text", parametersZodSchema: z.strictObject({}), func: () => "hello" });

    assert.equal((await tool.execute({}, { callId: "text-1" })).toolOutput, "hello");
});

test("exports JSON Schema in the SDK parameters field with descriptions and required keys", () => {
    const tool = new Tool({
        name: "addition",
        description: "Add two numbers",
        parametersZodSchema: z.strictObject({ a: z.number().describe("First number"), b: z.number() }),
        func: ({ a, b }) => a + b,
    });

    const spec = tool.getSpec();

    assert.equal(spec.type, "function");
    assert.equal(spec.name, "addition");
    assert.equal(spec.description, "Add two numbers");
    assert.equal(spec.parameters.type, "object");
    assert.deepEqual(spec.parameters.required, ["a", "b"]);
    assert.equal(spec.parameters.additionalProperties, false);
    assert.deepEqual(spec.parameters.properties, { a: { type: "number", description: "First number" }, b: { type: "number" } });
    assert.equal("parametersZodSchema" in spec, false);
    assert.equal("parametersJSONSchema" in spec, false);
    assert.equal(typeof JSON.stringify(spec), "string");
});
