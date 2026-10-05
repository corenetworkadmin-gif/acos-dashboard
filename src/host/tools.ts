// Generalized tool-call mediation.
//
// The Companion never executes anything. It may *request* a tool by emitting a
// structured call; ACOS then routes that request through the same versioned
// operation/admission/authorization/audit pipeline used by every other action.
// A tool is only a declared mapping onto a capability + action + target that the
// policy engine already understands, so a tool can never grant new authority.
//
// Model text is never executed: only a strictly-parsed JSON object inside the
// <tool_call> envelope is considered, and unknown, malformed or denied requests
// fail closed and are recorded in the audit journal.

export interface ToolParameter {
  name: string;
  type: "string";
  required: boolean;
  description: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  // The capability contract this tool maps onto. The runtime resolves it through
  // the ordinary operation pipeline; the tool layer holds no authority of its own.
  capability: string;
  action: string;
  target: string;
  // Which parameter supplies the operation input, if any.
  inputParameter?: string;
  parameters: ToolParameter[];
}

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolParseResult {
  calls: ParsedToolCall[];
  malformed: string[];
}

const CALL_OPEN = "<tool_call>";
const CALL_CLOSE = "</tool_call>";

// The tools this build declares to the model. Each maps 1:1 onto an implemented
// capability contract; the model cannot invent additional authority.
export function toolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "home.read",
      description: "Read the durable notes stored in the companion's Home.",
      capability: "home.read",
      action: "read",
      target: "companion/home",
      parameters: [],
    },
    {
      name: "home.write",
      description: "Save a short note to the companion's durable Home memory.",
      capability: "home.write",
      action: "write",
      target: "companion/home",
      inputParameter: "note",
      parameters: [
        {
          name: "note",
          type: "string",
          required: true,
          description: "The note to remember (1-4000 characters).",
        },
      ],
    },
  ];
}

// Human/engine-readable declaration injected into the system prompt. It states
// explicitly that ACOS, not the model, decides whether a request is allowed.
export function toolPromptSection(): string {
  const tools = toolDefinitions();
  if (!tools.length) return "";
  const lines = tools.map((tool) => {
    const params =
      tool.parameters
        .map(
          (param) =>
            `${param.name} (${param.type}${param.required ? ", required" : ""})`,
        )
        .join(", ") || "none";
    return `- ${tool.name}: ${tool.description} Parameters: ${params}.`;
  });
  return [
    "You may request a tool by emitting exactly one JSON object inside <tool_call></tool_call> tags and then stopping:",
    `${CALL_OPEN}{"name":"<tool>","arguments":{...}}${CALL_CLOSE}`,
    "Available tools:",
    ...lines,
    "ACOS — not you — decides whether each request is permitted, and returns the result or a denial. You cannot execute anything yourself and must not invent tools.",
  ].join("\n");
}

// Strict parser. Only a JSON object with a string `name` and an optional object
// `arguments` is accepted. Anything else is reported as malformed and never run.
export function parseToolCalls(text: string): ToolParseResult {
  const calls: ParsedToolCall[] = [];
  const malformed: string[] = [];
  const pattern = new RegExp(
    `${CALL_OPEN}([\\s\\S]*?)${CALL_CLOSE}`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1].trim();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        typeof (parsed as { name?: unknown }).name !== "string"
      )
        throw new Error("Tool call must be an object with a string name.");
      const args = (parsed as { arguments?: unknown }).arguments;
      if (
        args !== undefined &&
        (typeof args !== "object" || args === null || Array.isArray(args))
      )
        throw new Error("Tool call arguments must be an object.");
      calls.push({
        name: (parsed as { name: string }).name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
    } catch {
      malformed.push(raw);
    }
  }
  return { calls, malformed };
}

// Removes tool-call envelopes so only human-readable text is shown or stored.
export function stripToolCalls(text: string): string {
  return text
    .replace(new RegExp(`${CALL_OPEN}[\\s\\S]*?${CALL_CLOSE}`, "g"), "")
    .trim();
}

// Validates a parsed call against its declared schema and derives the operation
// input. Unknown parameters and type mismatches are rejected (fail closed).
export function toolInput(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): string {
  for (const key of Object.keys(args))
    if (!tool.parameters.some((param) => param.name === key))
      throw new Error(
        `Malformed tool call: unexpected parameter "${key}" for ${tool.name}.`,
      );
  for (const param of tool.parameters) {
    const value = args[param.name];
    if (value === undefined) {
      if (param.required)
        throw new Error(
          `Malformed tool call: missing required parameter "${param.name}".`,
        );
      continue;
    }
    if (typeof value !== param.type)
      throw new Error(
        `Malformed tool call: parameter "${param.name}" must be of type ${param.type}.`,
      );
  }
  if (!tool.inputParameter) return "";
  return String(args[tool.inputParameter] ?? "").trim();
}
