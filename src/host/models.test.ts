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

test("model resolution respects explicit family, pinned hash and conservative filenames", async () => {
  const { resolveModel, referenceModelHash } = await import("./models.ts");
  assert.equal(
    resolveModel({ sha256: referenceModelHash }).adapter,
    "qwen-chatml",
  );
  assert.throws(
    () => resolveModel({ sha256: referenceModelHash, id: "phi" }),
    /conflicts/,
  );
  for (const [filename, adapter] of [
    ["Qwen2.5-0.5B-Instruct-Q4.gguf", "qwen-chatml"],
    ["Llama-3.1-8B-Instruct.gguf", "llama3"],
    ["Mistral-7B-Instruct-v0.2.Q4.gguf", "mistral"],
    ["gemma-2-2b-it.gguf", "gemma"],
    ["Phi-3.5-mini-instruct.gguf", "phi"],
  ]) {
    const report = resolveModel({ filename });
    assert.equal(report.adapter, adapter);
    assert.equal(report.matchedBy, "filename");
    assert.equal(report.verifiedReference, false);
  }
  assert.equal(resolveModel({ filename: "unknown.gguf" }).compatible, false);
  assert.equal(
    resolveModel({ filename: "Mistral-7B-Instruct-v0.3.gguf" }).compatible,
    false,
  );
  assert.equal(
    resolveModel({ id: "llama-3", filename: "custom.gguf" }).adapter,
    "llama3",
  );
  assert.throws(
    () => resolveModel({ id: "phi", filename: "model.safetensors" }),
    /GGUF/,
  );
});
test("Mistral, Gemma and Phi framing retain system context and mediated tool replies", () => {
  const messages = [
    { role: "system" as const, text: "rules" },
    { role: "user" as const, text: "hello" },
  ];
  assert.equal(
    formatPrompt("mistral", messages),
    "<s> [INST] rules\n\nhello [/INST]",
  );
  assert.equal(
    formatPrompt("gemma", messages),
    "<bos><start_of_turn>user\nrules\n\nhello<end_of_turn>\n<start_of_turn>model\n",
  );
  assert.equal(
    formatPrompt("phi", messages),
    "<|system|>\nrules<|end|>\n<|user|>\nhello<|end|>\n<|assistant|>\n",
  );
  for (const id of ["mistral", "gemma", "phi"]) {
    const continued = appendToolResults(
      id,
      formatPrompt(id, messages),
      "checking",
      "DENIED",
    );
    assert.ok(continued.includes("Tool results from ACOS:\nDENIED"));
    assert.ok(!continued.includes("<|im_start|>"));
  }
});
