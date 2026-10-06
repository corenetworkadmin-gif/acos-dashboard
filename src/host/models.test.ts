import test from "node:test";
import assert from "node:assert/strict";
import { formatPrompt, appendToolResults, modelAdapter } from "./models.ts";
test("registered adapters frame roles and mediated tool results independently", () => {
  const messages = [{ role: "user" as const, text: "hello" }];
  const qwen = formatPrompt("qwen-chatml", messages);
  assert.equal(
    qwen,
    "<|im_start|>user\nhello<|im_end|>\n<|im_start|>assistant\n",
  );
  const llama = formatPrompt("llama3", messages);
  assert.ok(llama.startsWith("<|begin_of_text|><|start_header_id|>user"));
  const continuation = appendToolResults("llama3", llama, "checking", "DENIED");
  assert.ok(continuation.includes("Tool results from ACOS:\nDENIED<|eot_id|>"));
  assert.ok(!continuation.includes("<|im_start|>"));
  assert.throws(() => modelAdapter("arbitrary"), /Unsupported/);
});
