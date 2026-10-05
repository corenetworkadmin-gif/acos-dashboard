import test from "node:test";
import assert from "node:assert/strict";
import {
  parseToolCalls,
  stripToolCalls,
  toolDefinitions,
  toolInput,
  toolPromptSection,
} from "./tools.ts";

test("parseToolCalls extracts structured calls and rejects malformed envelopes", () => {
  const text =
    'Sure.\n<tool_call>{"name":"home.write","arguments":{"note":"hi"}}</tool_call>\n' +
    "<tool_call>not json</tool_call>\n" +
    '<tool_call>{"arguments":{}}</tool_call>\n' +
    '<tool_call>{"name":"home.read"}</tool_call>';
  const { calls, malformed } = parseToolCalls(text);
  assert.deepEqual(calls, [
    { name: "home.write", arguments: { note: "hi" } },
    { name: "home.read", arguments: {} },
  ]);
  assert.equal(malformed.length, 2);
});

test("parseToolCalls ignores arguments that are not an object", () => {
  const { calls, malformed } = parseToolCalls(
    '<tool_call>{"name":"home.read","arguments":[1,2]}</tool_call>',
  );
  assert.equal(calls.length, 0);
  assert.equal(malformed.length, 1);
});

test("stripToolCalls removes envelopes and leaves prose", () => {
  assert.equal(
    stripToolCalls(
      'Before <tool_call>{"name":"home.read"}</tool_call> after',
    ),
    "Before  after",
  );
});

test("toolInput validates required, typed and unexpected parameters", () => {
  const write = toolDefinitions().find((tool) => tool.name === "home.write")!;
  assert.equal(toolInput(write, { note: "  hello  " }), "hello");
  assert.throws(() => toolInput(write, {}), /missing required/);
  assert.throws(() => toolInput(write, { note: 42 }), /must be of type string/);
  assert.throws(() => toolInput(write, { note: "x", extra: "y" }), /unexpected/);
  const read = toolDefinitions().find((tool) => tool.name === "home.read")!;
  assert.equal(toolInput(read, {}), "");
});

test("toolPromptSection declares only implemented tools and states ACOS decides", () => {
  const section = toolPromptSection();
  assert.match(section, /home\.read/);
  assert.match(section, /home\.write/);
  assert.match(section, /ACOS .* decides/i);
  assert.doesNotMatch(section, /wallet|financial\.transfer/);
});
