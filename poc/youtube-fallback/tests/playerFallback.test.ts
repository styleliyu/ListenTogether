import assert from "node:assert/strict";
import { isRuntimeSourceFailure } from "../web/playerFallback.js";

assert.equal(isRuntimeSourceFailure(100), true);
assert.equal(isRuntimeSourceFailure(101), true);
assert.equal(isRuntimeSourceFailure(150), true);
assert.equal(isRuntimeSourceFailure(153), false);

console.log("player fallback contract ok: 100/101/150 source failure classification");
