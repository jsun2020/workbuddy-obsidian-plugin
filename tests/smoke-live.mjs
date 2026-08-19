// Live smoke test: drives the REAL WorkBuddy CLI through the plugin's own
// cliClient (outside Obsidian). Not part of `npm test` - needs WorkBuddy
// installed + signed in + network. Run: `npm run smoke:live`.
//
// Asserts: install check OK; turn 1 streams text + returns a session id;
// turn 2 with --resume remembers turn 1; abort() kills a running turn.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// cliClient uses window.setTimeout (Obsidian popout-window rule); provide it under Node.
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
const { WorkBuddyCliClient } = await import("./.build/cliClient.mjs");
import { makeT } from "./.build/i18n.mjs";

const settings = {
  cliPath: "",
  nodePath: "",
  language: "en",
  userName: "",
  permissionMode: "readonly",
  model: "",
  reasoningEffort: "",
  maxTurns: 2,
  workingFolder: "",
  includeNoteContent: true,
  maxTabs: 3,
  idleTimeoutSec: 180,
  markdownFormattingPromptEnabled: true,
  customSystemPrompt: "",
  showThinking: true
};
const client = new WorkBuddyCliClient(() => settings, () => makeT("en"));

function turn(opts) {
  return new Promise((resolve, reject) => {
    const events = [];
    let text = "";
    const handle = client.sendMessage(opts, {
      onEvent: (e) => {
        events.push(e);
        if (e.kind === "text") text += e.text;
      },
      onError: (m) => reject(new Error(m)),
      onDone: (sid) => resolve({ events, text, sid })
    });
    opts.onHandle?.(handle);
  });
}

const cwd = mkdtempSync(join(tmpdir(), "wb-plugin-smoke-"));
try {
  console.log("[1] checkInstall");
  const chk = await client.checkInstall();
  console.log("    ", JSON.stringify({ ok: chk.ok, version: chk.version, cli: chk.cliPath, node: chk.nodePath, kind: chk.runtimeKind, error: chk.error }));
  assert.equal(chk.ok, true, chk.error);
  assert.match(chk.version, /^\d+\.\d+\.\d+$/);

  console.log("[2] turn 1");
  const t1 = await turn({ prompt: "My secret word is 'lantern'. Reply with exactly one short sentence acknowledging it.", cwd, systemPrompt: "Be brief." });
  console.log("     text:", JSON.stringify(t1.text), "session:", t1.sid);
  assert.ok(t1.text.trim().length > 0, "turn 1 produced text");
  assert.ok(t1.sid, "turn 1 returned a session id");
  assert.ok(t1.events.some((e) => e.kind === "init"), "init event seen");
  assert.ok(t1.events.some((e) => e.kind === "result"), "result event seen");
  const textEvents = t1.events.filter((e) => e.kind === "text");
  assert.ok(textEvents.length >= 1, "streamed text deltas");
  // Dedupe check: the final assistant message must not have doubled the text.
  const joined = textEvents.map((e) => e.text).join("");
  assert.equal(joined, t1.text);
  assert.ok(!/lantern[\s\S]*lantern[\s\S]*lantern/i.test(joined), "text not duplicated by full-message re-emit");

  console.log("[3] turn 2 (resume)");
  const t2 = await turn({ prompt: "What is my secret word? Answer with just the word.", cwd, systemPrompt: "Be brief.", sessionId: t1.sid });
  console.log("     text:", JSON.stringify(t2.text), "session:", t2.sid);
  assert.match(t2.text.toLowerCase(), /lantern/, "resumed session remembers context");
  assert.equal(t2.sid, t1.sid, "session id stable across --resume");

  console.log("[4] abort");
  const started = Date.now();
  let handle;
  const aborted = await new Promise((resolve) => {
    handle = client.sendMessage(
      { prompt: "Count slowly from 1 to 500, one number per line.", cwd, systemPrompt: "" },
      {
        onEvent: (e) => {
          if (e.kind === "init" && handle) {
            handle.abort();
            setTimeout(() => resolve("aborted-silently"), 1500);
          }
        },
        onError: (m) => resolve("error:" + m),
        onDone: () => resolve("done")
      }
    );
  });
  console.log("     ", aborted, `${Date.now() - started}ms`);
  assert.equal(aborted, "aborted-silently", "abort emits neither onDone nor onError");

  console.log("SMOKE OK");
} finally {
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
