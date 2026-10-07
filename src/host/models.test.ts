import test from "node:test";
import assert from "node:assert/strict";
import { formatPrompt, appendToolResults, modelAdapter, modelRegistry } from "./models.ts";
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

test("qwen-chatml covers the Qwen3 family for non-reference model configuration", () => {
  const qwen = modelRegistry.find((entry) => entry.id === "qwen-chatml");
  assert.ok(qwen);
  assert.ok(qwen.families.includes("Qwen3"));
  // Adapter choice stays explicit: nothing infers it from the file or family.
  assert.equal(modelAdapter("qwen-chatml").template, "chatml");
});
