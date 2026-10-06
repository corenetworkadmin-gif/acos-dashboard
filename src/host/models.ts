// Host-selected prompt adapters. Model text never selects an adapter or grants tools.
export const modelRegistry = [
  {
    id: "qwen-chatml",
    families: ["Qwen2", "Qwen2.5"],
    format: "GGUF",
    tokenizer: "GPT-2 BPE",
    template: "chatml",
  },
  {
    id: "llama3",
    families: ["Llama 3", "Llama 3.1", "Llama 3.2"],
    format: "GGUF",
    tokenizer: "Llama 3 BPE",
    template: "llama3",
  },
] as const;
export type ModelAdapterId = (typeof modelRegistry)[number]["id"];
export function modelAdapter(id = "qwen-chatml") {
  const entry = modelRegistry.find((item) => item.id === id);
  if (!entry)
    throw new Error(
      `Unsupported model adapter: ${id}. Choose a registered adapter.`,
    );
  return entry;
}
export interface PromptMessage {
  role: "system" | "user" | "assistant" | "tool";
  text: string;
}
function segment(id: string, message: PromptMessage) {
  if (modelAdapter(id).template === "chatml")
    return `<|im_start|>${message.role}\n${message.text}<|im_end|>\n`;
  // Tool results are host-provided context. No native Llama tool-execution syntax
  // is accepted: ACOS's existing parsed JSON mediation remains the only tool path.
  const role = message.role === "tool" ? "user" : message.role;
  const text =
    message.role === "tool"
      ? `Tool results from ACOS:\n${message.text}`
      : message.text;
  return `<|start_header_id|>${role}<|end_header_id|>\n\n${text}<|eot_id|>`;
}
function assistantPrefix(id: string) {
  return modelAdapter(id).template === "chatml"
    ? "<|im_start|>assistant\n"
    : "<|start_header_id|>assistant<|end_header_id|>\n\n";
}
export function formatPrompt(id: string, messages: PromptMessage[]) {
  return (
    (modelAdapter(id).template === "llama3" ? "<|begin_of_text|>" : "") +
    messages.map((m) => segment(id, m)).join("") +
    assistantPrefix(id)
  );
}
export function appendToolResults(
  id: string,
  prompt: string,
  response: string,
  results: string,
) {
  const end =
    modelAdapter(id).template === "chatml" ? "<|im_end|>\n" : "<|eot_id|>";
  return (
    prompt +
    response +
    end +
    segment(id, { role: "tool", text: results }) +
    assistantPrefix(id)
  );
}
