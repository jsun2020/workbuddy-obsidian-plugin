import test from "node:test";
import assert from "node:assert/strict";
import { StreamJsonParser, toolPreview, relativeToCwd, classifyError } from "./.build/protocol.mjs";

const line = (o) => JSON.stringify(o) + "\n";

test("init event carries session id, model, tools, permission mode", () => {
  const p = new StreamJsonParser("C:\\vault");
  const ev = p.feed(
    line({
      type: "system",
      subtype: "init",
      session_id: "s-1",
      model: "auto",
      tools: ["Read", "Write"],
      permissionMode: "acceptEdits"
    })
  );
  assert.deepEqual(ev, [{ kind: "init", sessionId: "s-1", model: "auto", tools: ["Read", "Write"], permissionMode: "acceptEdits" }]);
});

test("text and thinking deltas stream; the full assistant message with the same id is not re-rendered", () => {
  const p = new StreamJsonParser();
  const out = [];
  out.push(...p.feed(line({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } })));
  out.push(...p.feed(line({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } })));
  out.push(...p.feed(line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } } })));
  out.push(...p.feed(line({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "text" } } })));
  out.push(...p.feed(line({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hel" } } })));
  out.push(...p.feed(line({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "lo" } } })));
  // Full message re-emitted by the CLI (same id) - must NOT duplicate text.
  out.push(
    ...p.feed(
      line({
        type: "assistant",
        message: { id: "m1", content: [{ type: "text", text: "Hello" }], usage: { input_tokens: 10, output_tokens: 2 } }
      })
    )
  );
  assert.deepEqual(out, [
    { kind: "thinking", text: "hmm" },
    { kind: "text", text: "Hel" },
    { kind: "text", text: "lo" },
    { kind: "usage", inputTokens: 10, outputTokens: 2 }
  ]);
});

test("thinking-only assistant message with a FRESH id is not re-rendered while partial streaming is active", () => {
  const p = new StreamJsonParser();
  p.feed(line({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } }));
  p.feed(line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } } }));
  const ev = p.feed(line({ type: "assistant", message: { id: "other-id", content: [{ type: "thinking", thinking: "plan" }] } }));
  assert.deepEqual(ev, []);
});

test("assistant text block with a fresh id but verbatim-streamed text is skipped; genuinely new text is kept", () => {
  const p = new StreamJsonParser();
  p.feed(line({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } }));
  p.feed(line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done" } } }));
  assert.deepEqual(p.feed(line({ type: "assistant", message: { id: "fresh", content: [{ type: "text", text: "done" }] } })), []);
  // Synthetic message that was never streamed (e.g. "Max turns exceeded").
  assert.deepEqual(p.feed(line({ type: "assistant", message: { id: "synthetic", content: [{ type: "text", text: "Max turns (1) exceeded" }] } })), [
    { kind: "text", text: "Max turns (1) exceeded" }
  ]);
});

test("without partial events, assistant text and thinking are rendered from the message", () => {
  const p = new StreamJsonParser();
  const ev = p.feed(
    line({ type: "assistant", message: { id: "m", content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "pong" }] } })
  );
  assert.deepEqual(ev, [
    { kind: "thinking", text: "t" },
    { kind: "text", text: "pong" }
  ]);
});

test("tool_use -> tool_start with preview; tool_result -> tool_end with error detection", () => {
  const p = new StreamJsonParser("C:\\vault");
  const start = p.feed(
    line({
      type: "assistant",
      message: { id: "m2", content: [{ type: "tool_use", id: "call_1", name: "Read", input: { file_path: "C:\\vault\\notes\\a.md" } }] }
    })
  );
  assert.deepEqual(start, [{ kind: "tool_start", id: "call_1", name: "Read", preview: "notes/a.md" }]);
  const ok = p.feed(
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "# hello" }], is_error: false }] } })
  );
  assert.deepEqual(ok, [{ kind: "tool_end", id: "call_1", isError: false, preview: "# hello" }]);
  const denied = p.feed(
    line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "call_2", content: [{ type: "text", text: "Error: Permission to use Write has been denied" }] }] }
    })
  );
  assert.equal(denied[0].isError, true);
});

test("result event", () => {
  const p = new StreamJsonParser();
  const ev = p.feed(
    line({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "pong",
      session_id: "s-9",
      num_turns: 2,
      duration_ms: 1234,
      usage: { input_tokens: 100, output_tokens: 5 },
      permission_denials: [{ tool_name: "Bash" }]
    })
  );
  assert.deepEqual(ev, [
    {
      kind: "result",
      isError: false,
      text: "pong",
      sessionId: "s-9",
      numTurns: 2,
      durationMs: 1234,
      deniedTools: ["Bash"],
      inputTokens: 100,
      outputTokens: 5
    }
  ]);
});

test("line buffering: split chunks and trailing partial line via flush; garbage ignored", () => {
  const p = new StreamJsonParser();
  const json = JSON.stringify({ type: "result", subtype: "success", result: "x", session_id: "s" });
  const a = p.feed(json.slice(0, 10));
  assert.deepEqual(a, []);
  const b = p.feed(json.slice(10) + "\nnot json at all\n");
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, "result");
  const c = p.feed(JSON.stringify({ type: "system", subtype: "init", session_id: "z" }));
  assert.deepEqual(c, []);
  const d = p.flush();
  assert.equal(d[0].kind, "init");
  assert.equal(d[0].sessionId, "z");
});

test("toolPreview covers common tools and truncates", () => {
  assert.equal(toolPreview("Bash", { command: "git status", description: "Show status" }, ""), "Show status");
  assert.equal(toolPreview("Grep", { pattern: "TODO" }, ""), '"TODO"');
  assert.equal(toolPreview("WebSearch", { query: "obsidian plugins" }, ""), "obsidian plugins");
  assert.equal(toolPreview("Mystery", { foo: 1, bar: "x".repeat(200) }, "").length, 90);
  assert.equal(toolPreview("Read", "not an object", ""), "");
});

test("relativeToCwd handles separators and case", () => {
  assert.equal(relativeToCwd("C:\\Vault\\a\\b.md", "c:/vault"), "a/b.md");
  assert.equal(relativeToCwd("/other/x.md", "/vault"), "/other/x.md");
});

test("classifyError spots auth problems in English and Chinese", () => {
  assert.equal(classifyError("HTTP 401 Unauthorized"), "auth");
  assert.equal(classifyError("Please log in first"), "auth");
  assert.equal(classifyError("请先登录 WorkBuddy"), "auth");
  assert.equal(classifyError("ENOENT spawn"), "other");
});
