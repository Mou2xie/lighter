import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessage, UserMessage } from "../core/messages.js";
import { Model } from "../model/model.js";
import { MockProvider } from "../providers/mock-provider.js";

test("MockProvider works through Model and yields a finite sequence of replies in order", async () => {
    const model = new Model(new MockProvider([new AssistantMessage("first"), new AssistantMessage("second")]));

    assert.equal((await model.invoke({ messages: [new UserMessage("Hi")], toolSpecs: [] })).content, "first");
    assert.equal((await model.invoke({ messages: [new UserMessage("Again")], toolSpecs: [] })).content, "second");
    await assert.rejects(model.invoke({ messages: [], toolSpecs: [] }), /no responses remaining/i);
});

test("an empty mock sequence fails explicitly instead of returning undefined", async () => {
    await assert.rejects(new Model(new MockProvider([])).invoke({ messages: [], toolSpecs: [] }), /no responses remaining/i);
});

test("MockProvider stream yields each final message once and shares exhaustion with invoke", async () => {
    const first = new AssistantMessage("first");
    const second = new AssistantMessage("second");
    const model = new Model(new MockProvider([first, second]));
    const items = [];
    for await (const item of model.stream({ messages: [], toolSpecs: [] })) items.push(item);
    assert.deepEqual(items, [{ type: "message", message: first }]);
    assert.equal(await model.invoke({ messages: [], toolSpecs: [] }), second);
    await assert.rejects(async () => { for await (const _ of model.stream({ messages: [], toolSpecs: [] })) {} }, /no responses remaining/i);
});

test("Model stream forwards event identity and closes the source on early return", async () => {
    const delta = { type: "text_delta" as const, text: "first" };
    let closed = false;
    const model = new Model({
        name: "cleanup",
        async invoke() { throw new Error("Use stream"); },
        async *stream() {
            try { yield delta; throw new Error("Must not resume after cancellation"); }
            finally { closed = true; }
        },
    });
    const iterator = model.stream({ messages: [], toolSpecs: [] });
    assert.equal((await iterator.next()).value, delta);
    await iterator.return(undefined);
    assert.equal(closed, true);
});
