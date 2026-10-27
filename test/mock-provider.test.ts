import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessage, UserMessage } from "../core/protocol.js";
import { Model } from "../model/model.js";
import { MockProvider } from "../model/providers/mock-provider.js";

test("MockProvider works through Model and yields a finite sequence of replies in order", async () => {
    const model = new Model(new MockProvider([new AssistantMessage("first"), new AssistantMessage("second")]));

    assert.equal((await model.invoke([new UserMessage("Hi")], [])).content, "first");
    assert.equal((await model.invoke([new UserMessage("Again")], [])).content, "second");
    await assert.rejects(model.invoke([], []), /no responses remaining/i);
});

test("an empty mock sequence fails explicitly instead of returning undefined", async () => {
    await assert.rejects(new Model(new MockProvider([])).invoke([], []), /no responses remaining/i);
});
