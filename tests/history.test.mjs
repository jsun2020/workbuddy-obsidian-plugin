import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveTitle,
  lastMessagePreview,
  tabLabel,
  upsertConversation,
  removeConversation,
  relativeTimeParts,
  parseHistoryFile,
  serializeHistoryFile
} from "./.build/history.mjs";

test("deriveTitle uses display text, truncates, falls back", () => {
  assert.equal(deriveTitle([{ role: "user", content: "<current_note>x</current_note>", display: "  Summarise   this " }]), "Summarise this");
  assert.equal(deriveTitle([{ role: "user", content: "a".repeat(80) }]), "a".repeat(57) + "...");
  assert.equal(deriveTitle([], "新对话"), "新对话");
});

test("lastMessagePreview needs two visible messages and uses role labels", () => {
  assert.equal(lastMessagePreview([{ role: "user", content: "hi" }]), "");
  assert.equal(
    lastMessagePreview([{ role: "user", content: "hi" }, { role: "assistant", content: "hello there" }], { you: "你", assistant: "WorkBuddy" }),
    "WorkBuddy: hello there"
  );
});

test("tabLabel truncates at 20", () => {
  assert.equal(tabLabel(""), "Chat");
  assert.equal(tabLabel("", "对话"), "对话");
  assert.equal(tabLabel("x".repeat(30)), "x".repeat(18) + "...");
});

test("upsert keeps newest first, replaces by id, caps size; remove works", () => {
  const a = { id: "a", title: "A", updatedAt: 1, messages: [] };
  const b = { id: "b", title: "B", updatedAt: 2, messages: [] };
  let list = upsertConversation([a], b);
  assert.deepEqual(list.map((c) => c.id), ["b", "a"]);
  list = upsertConversation(list, { ...a, updatedAt: 3 });
  assert.deepEqual(list.map((c) => c.id), ["a", "b"]);
  list = upsertConversation(list, { id: "c", title: "C", updatedAt: 4, messages: [] }, 2);
  assert.deepEqual(list.map((c) => c.id), ["c", "a"]);
  assert.deepEqual(removeConversation(list, "c").map((c) => c.id), ["a"]);
});

test("relativeTimeParts buckets", () => {
  const now = 1_000_000_000_000;
  assert.deepEqual(relativeTimeParts(now, now - 10_000), { unit: "justNow", n: 0 });
  assert.deepEqual(relativeTimeParts(now, now - 5 * 60_000), { unit: "m", n: 5 });
  assert.deepEqual(relativeTimeParts(now, now - 3 * 3_600_000), { unit: "h", n: 3 });
  assert.deepEqual(relativeTimeParts(now, now - 2 * 86_400_000), { unit: "d", n: 2 });
  assert.deepEqual(relativeTimeParts(now, now - 400 * 86_400_000), { unit: "y", n: 1 });
});

test("parse/serialize round trip and defensive parsing", () => {
  const conv = {
    id: "c1",
    title: "T",
    sessionId: "s1",
    updatedAt: 5,
    messages: [
      { role: "user", content: "full prompt", display: "typed", attachments: { notePath: "n.md", selection: "sel" } },
      { role: "assistant", content: "reply" }
    ]
  };
  const parsed = parseHistoryFile(serializeHistoryFile([conv]));
  assert.deepEqual(parsed, [conv]);
  assert.deepEqual(parseHistoryFile("not json"), []);
  assert.deepEqual(parseHistoryFile(JSON.stringify({ conversations: [{ id: 1 }, { id: "ok", messages: [{ role: "bogus", content: "x" }, { role: "user", content: "y" }] }] })), [
    { id: "ok", title: "y", sessionId: undefined, updatedAt: 0, messages: [{ role: "user", content: "y" }] }
  ]);
});
