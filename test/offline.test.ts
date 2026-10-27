import "./helpers/offline.js";
import assert from "node:assert/strict";
import { test } from "node:test";

test("unmocked fetch calls are rejected by the offline guard", async () => {
    await assert.rejects(fetch("https://network-disabled.invalid"), /Network access is disabled in offline tests/);
});
