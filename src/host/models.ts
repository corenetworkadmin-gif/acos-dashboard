// Registry entries describe supported framing, not proof that an arbitrary GGUF
// carries a compatible tokenizer. Actual model loading stays inside llama.cpp.
export const referenceModelHash =
  "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db";
export const modelRegistry = [
  {
    id: "qwen-chatml",
    families: ["Qwen2", "Qwen2.5"],
    format: "GGUF",
    tokenizer: "GPT-2 BPE",
    template: "chatml",
    aliases: ["chatml", "qwen"],
    filename: /qwen2(?:[._-]5)?[._-]/i,
  },
  {
    id: "llama3",
    families: ["Llama 3", "Llama 3.1", "Llama 3.2"],
    format: "GGUF",
    tokenizer: "Llama 3 BPE",
    template: "llama3",
    aliases: ["llama-3"],
    filename: /llama[._-]?3(?:[._-][12])?[._-]/i,
  },
  {
    id: "mistral",
    families: ["Mistral 7B Instruct v0.1", "Mistral 7B Instruct v0.2"],
    format: "GGUF",
    tokenizer: "SentencePiece",
    template: "mistral",
    aliases: ["mistral-v0.2"],
    filename: /mistral.*instruct.*v0[._-][12](?:[._-]|$)/i,
  },
  {
    id: "gemma",
    families: ["Gemma IT", "Gemma 2 IT"],
    format: "GGUF",
    tokenizer: "SentencePiece",
    template: "gemma",
    aliases: ["gemma2"],
    filename: /gemma(?:[._-]?2)?[._-](?!3|4).*\bit\b/i,
  },
  {
    id: "phi",
    families: ["Phi-3 Instruct", "Phi-3.5 Instruct"],
    format: "GGUF",
    tokenizer: "SentencePiece",
    template: "phi",
    aliases: ["phi3", "phi-3"],
    filename: /phi[._-]?3(?:[._-]5)?[._-].*instruct/i,
  },
] as const;
export type ModelAdapterId = (typeof modelRegistry)[number]["id"];
export function modelAdapter(id = "qwen-chatml") {
  const entry = modelRegistry.find(
    (item) =>
      item.id === id || (item.aliases as readonly string[]).includes(id),
  );
  if (!entry)
    throw new Error(
      `Unsupported model adapter: ${id}. Choose a registered adapter.`,
    );
  return entry;
}
export function resolveModel(input: {
  id?: string;
  filename?: string;
  sha256?: string;
}) {
  const knownHash = input.sha256?.toLowerCase() === referenceModelHash;
  const explicit = input.id ? modelAdapter(input.id) : null;
  if (knownHash && explicit && explicit.id !== "qwen-chatml")
    throw new Error("Model hash conflicts with the requested family.");
  const filename = input.filename?.split(/[\\/]/).pop() ?? "";
  if (filename && !/\.gguf$/i.test(filename))
    throw new Error("Only GGUF model files are supported.");
  const candidates = modelRegistry.filter((item) =>
    item.filename.test(filename),
  );
  const adapter =
    explicit ??
    (knownHash
      ? modelAdapter("qwen-chatml")
      : candidates.length === 1
        ? candidates[0]
        : null);
  return {
    adapter: adapter?.id ?? null,
    matchedBy: explicit
      ? "id"
      : knownHash
        ? "sha256"
        : adapter
          ? "filename"
          : "unknown",
    compatible: adapter !== null,
    verifiedReference: knownHash,
    reason: !adapter
      ? "Unknown or ambiguous family; configure ACOS_MODEL_FAMILY explicitly."
      : knownHash
        ? "Pinned reference adapter; integrity and isolated load are still required."
        : "Declared framing only; independently verify the GGUF tokenizer and isolated load before use.",
  };
}
export interface PromptMessage {
  role: "system" | "user" | "assistant" | "tool";
  text: string;
}
function segment(id: string, message: PromptMessage) {
  const template = modelAdapter(id).template;
  if (template === "chatml")
    return `<|im_start|>${message.role}\n${message.text}<|im_end|>\n`;
  const role = message.role === "tool" ? "user" : message.role;
  const text =
    message.role === "tool"
      ? `Tool results from ACOS:\n${message.text}`
      : message.text;
  if (template === "llama3")
    return `<|start_header_id|>${role}<|end_header_id|>\n\n${text}<|eot_id|>`;
  if (template === "phi") return `<|${role}|>\n${text}<|end|>\n`;
  if (template === "gemma")
    return `<start_of_turn>${role === "assistant" ? "model" : role}\n${text}<end_of_turn>\n`;
  return role === "assistant" ? ` ${text}</s>` : ` [INST] ${text} [/INST]`;
}
function assistantPrefix(id: string) {
  switch (modelAdapter(id).template) {
    case "chatml":
      return "<|im_start|>assistant\n";
    case "llama3":
      return "<|start_header_id|>assistant<|end_header_id|>\n\n";
    case "phi":
      return "<|assistant|>\n";
    case "gemma":
      return "<start_of_turn>model\n";
    case "mistral":
      return "";
  }
}
export function formatPrompt(id: string, messages: PromptMessage[]) {
  const template = modelAdapter(id).template;
  let normalized = messages;
  if (template === "mistral" || template === "gemma") {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.text)
      .join("\n\n");
    normalized = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ ...m }));
    const first = normalized.find((m) => m.role === "user");
    if (system && !first)
      throw new Error(
        "This model family requires a user message for system context.",
      );
    if (first && system) first.text = system + "\n\n" + first.text;
  }
  const bos =
    template === "llama3"
      ? "<|begin_of_text|>"
      : template === "mistral"
        ? "<s>"
        : template === "gemma"
          ? "<bos>"
          : "";
  return (
    bos + normalized.map((m) => segment(id, m)).join("") + assistantPrefix(id)
  );
}
export function appendToolResults(
  id: string,
  prompt: string,
  response: string,
  results: string,
) {
  const template = modelAdapter(id).template;
  const end = {
    chatml: "<|im_end|>\n",
    llama3: "<|eot_id|>",
    phi: "<|end|>\n",
    gemma: "<end_of_turn>\n",
    mistral: "</s>",
  }[template];
  return (
    prompt +
    response +
    end +
    segment(id, { role: "tool", text: results }) +
    assistantPrefix(id)
  );
}
