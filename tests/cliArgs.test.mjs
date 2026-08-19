import test from "node:test";
import assert from "node:assert/strict";
import { buildCliArgs, permissionArgs, buildStdinMessage, WRITE_TOOLS } from "./.build/cliArgs.mjs";

test("permission modes map to the verified CLI flags", () => {
  assert.deepEqual(permissionArgs("edits"), ["--permission-mode", "acceptEdits"]);
  assert.deepEqual(permissionArgs("full"), ["--permission-mode", "bypassPermissions"]);
  const ro = permissionArgs("readonly");
  assert.deepEqual(ro.slice(0, 2), ["--permission-mode", "default"]);
  assert.equal(ro[2], "--disallowedTools");
  for (const t of ["Write", "Edit", "Bash", "PowerShell"]) assert.ok(ro[3].split(",").includes(t), t);
  assert.ok(WRITE_TOOLS.length >= 4);
});

test("base args are the verified non-interactive stream-json invocation", () => {
  const a = buildCliArgs({ permissionMode: "edits" });
  assert.deepEqual(a.slice(0, 6), ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages"]);
  assert.ok(!a.includes("--model"));
  assert.ok(!a.includes("--resume"));
  assert.ok(!a.includes("--max-turns"));
  assert.ok(!a.includes("--effort"));
});

test("optional flags: model (auto omitted), effort, max turns, resume, system prompt", () => {
  const a = buildCliArgs({
    permissionMode: "readonly",
    model: "glm-5.1",
    effort: "high",
    maxTurns: 12.7,
    sessionId: "abc-123",
    systemPrompt: "Be brief."
  });
  const at = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(at("--model"), "glm-5.1");
  assert.equal(at("--effort"), "high");
  assert.equal(at("--max-turns"), "12");
  assert.equal(at("--resume"), "abc-123");
  assert.equal(at("--append-system-prompt"), "Be brief.");
  assert.ok(!buildCliArgs({ permissionMode: "edits", model: "auto" }).includes("--model"));
  assert.ok(!buildCliArgs({ permissionMode: "edits", maxTurns: 0 }).includes("--max-turns"));
});

test("stdin message is one NDJSON user line", () => {
  const s = buildStdinMessage("hi\nthere");
  assert.ok(s.endsWith("\n"));
  const obj = JSON.parse(s);
  assert.equal(obj.type, "user");
  assert.equal(obj.message.content[0].text, "hi\nthere");
});
