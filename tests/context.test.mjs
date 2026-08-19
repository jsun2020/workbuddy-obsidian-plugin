import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, resolveWorkingFolder, buildSystemInstructions, vaultInstructions } from "./.build/context.mjs";

test("buildPrompt: plain text only", () => {
  assert.equal(buildPrompt("  hello  ", {}), "hello");
});

test("buildPrompt: selection + note content blocks, path-only fallback", () => {
  const p = buildPrompt("fix", { notePath: "a/b.md", selection: "sel", noteContent: "full" });
  assert.ok(p.includes("<editor_selection>"));
  assert.ok(p.includes("<file_path>a/b.md</file_path>"));
  assert.ok(p.includes("<selection>\nsel\n</selection>"));
  assert.ok(p.includes("<current_note>\n<file_path>a/b.md</file_path>\n<content>\nfull\n</content>\n</current_note>"));
  const q = buildPrompt("x", { notePath: "n.md" });
  assert.ok(q.endsWith("<current_note>n.md</current_note>"));
  const r = buildPrompt("x", { notePath: "n.md", selection: "   " });
  assert.ok(!r.includes("<editor_selection>"));
});

test("resolveWorkingFolder: vault root, relative, absolute, windows/posix", () => {
  assert.equal(resolveWorkingFolder("C:\\Vault\\", ""), "C:\\Vault");
  assert.equal(resolveWorkingFolder("C:\\Vault", "Projects/x"), "C:\\Vault\\Projects\\x");
  assert.equal(resolveWorkingFolder("C:\\Vault", "/Projects"), "C:\\Vault\\Projects");
  assert.equal(resolveWorkingFolder("C:\\Vault", "D:\\Other\\"), "D:\\Other");
  assert.equal(resolveWorkingFolder("/home/me/vault", "/abs"), "/abs");
  assert.equal(resolveWorkingFolder("/home/me/vault", "sub"), "/home/me/vault/sub");
  assert.equal(resolveWorkingFolder("", "sub"), "sub");
});

test("system instructions: folder + markdown reminder + custom, in that order; toggles respected", () => {
  const s = buildSystemInstructions("C:\\Vault", { customPrompt: "Be terse.", vaultRoot: "C:\\Vault" });
  const iFolder = s.indexOf("Obsidian vault");
  const iMd = s.indexOf("rendered as Markdown");
  const iCustom = s.indexOf("Be terse.");
  assert.ok(iFolder >= 0 && iMd > iFolder && iCustom > iMd);
  assert.ok(!s.includes("(sub-folder)"));
  const sub = vaultInstructions("C:\\Vault\\Notes", "C:\\Vault");
  assert.ok(sub.includes("(sub-folder)"));
  const noMd = buildSystemInstructions("C:\\Vault", { markdownFormattingEnabled: false });
  assert.ok(!noMd.includes("rendered as Markdown"));
  assert.equal(buildSystemInstructions("", { markdownFormattingEnabled: false }), "");
});
