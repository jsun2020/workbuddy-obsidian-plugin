import test from "node:test";
import assert from "node:assert/strict";
import { cliCandidates, nodeCandidates, resolveRuntime, electronBesideCli, cliNeedsNode, looksLikeElectron } from "./.build/locate.mjs";

const WIN_CLI = "C:\\Users\\me\\AppData\\Local\\Programs\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy";
const WIN_BUNDLED_NODE = "C:\\Users\\me\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe";

function winEnv(existing, dirs = {}) {
  const set = new Set(existing.map((p) => p.toLowerCase()));
  return {
    platform: "win32",
    home: "C:\\Users\\me",
    localAppData: "C:\\Users\\me\\AppData\\Local",
    programFiles: "C:\\Program Files",
    pathDirs: ["C:\\Windows\\System32", "C:\\Program Files\\nodejs"],
    exists: (p) => set.has(p.toLowerCase()),
    listDir: (p) => dirs[p.toLowerCase()] || []
  };
}

test("Windows CLI candidates start with the per-user install, PATH shims last", () => {
  const c = cliCandidates(winEnv([]));
  assert.equal(c[0], WIN_CLI);
  assert.ok(c.includes("C:\\Program Files\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy"));
  assert.equal(c[c.length - 1], "C:\\Program Files\\nodejs\\codebuddy.cmd");
});

test("resolveRuntime finds the install CLI and prefers the bundled node (highest version) over Electron and PATH", () => {
  const versionsDir = "c:\\users\\me\\.workbuddy\\binaries\\node\\versions";
  const env = winEnv(
    [WIN_CLI, WIN_BUNDLED_NODE, "C:\\Users\\me\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe", "C:\\Program Files\\nodejs\\node.exe"],
    { [versionsDir]: ["20.1.0", "22.22.2", "junk"] }
  );
  const r = resolveRuntime(env);
  assert.equal(r.cliPath, WIN_CLI);
  assert.equal(r.cliSource, "install");
  assert.equal(r.node.path, WIN_BUNDLED_NODE);
  assert.equal(r.node.electron, false);
  assert.equal(r.node.source, "bundled");
});

test("falls back to WorkBuddy.exe as the runtime (ELECTRON_RUN_AS_NODE) when no bundled node exists", () => {
  const env = winEnv([WIN_CLI, "C:\\Users\\me\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe"]);
  const r = resolveRuntime(env);
  assert.equal(r.node.path, "C:\\Users\\me\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe");
  assert.equal(r.node.electron, true);
  assert.equal(r.node.source, "electron");
});

test("falls back to node on PATH; reports null when nothing exists", () => {
  const env1 = winEnv([WIN_CLI, "C:\\Program Files\\nodejs\\node.exe"]);
  assert.equal(resolveRuntime(env1).node.source, "path");
  const env2 = winEnv([]);
  const r = resolveRuntime(env2);
  assert.equal(r.cliPath, null);
  assert.equal(r.node, null);
  assert.ok(r.triedCli.length > 0);
});

test("overrides win when they exist; a bad override is tried then auto-detection continues", () => {
  const env = winEnv([WIN_CLI, WIN_BUNDLED_NODE, "D:\\custom\\codebuddy", "D:\\custom\\node.exe"], {
    "c:\\users\\me\\.workbuddy\\binaries\\node\\versions": ["22.22.2"]
  });
  const r = resolveRuntime(env, { cliPath: "D:\\custom\\codebuddy", nodePath: "D:\\custom\\node.exe" });
  assert.equal(r.cliPath, "D:\\custom\\codebuddy");
  assert.equal(r.cliSource, "override");
  assert.equal(r.node.source, "override");
  const bad = resolveRuntime(env, { cliPath: "D:\\nope\\codebuddy" });
  assert.equal(bad.cliPath, WIN_CLI);
  assert.equal(bad.triedCli[0], "D:\\nope\\codebuddy");
});

test("a PATH shim is reported as source 'path'", () => {
  const env = winEnv(["C:\\Program Files\\nodejs\\codebuddy.cmd", "C:\\Program Files\\nodejs\\node.exe"]);
  const r = resolveRuntime(env);
  assert.equal(r.cliSource, "path");
  assert.equal(cliNeedsNode(r.cliPath), false);
});

test("macOS layout guesses", () => {
  const env = {
    platform: "darwin",
    home: "/Users/me",
    localAppData: "",
    programFiles: "",
    pathDirs: ["/usr/local/bin"],
    exists: () => false,
    listDir: () => []
  };
  const c = cliCandidates(env);
  assert.equal(c[0], "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy");
  assert.equal(electronBesideCli(env, c[0]), "/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy");
  const n = nodeCandidates(env, c[0]);
  assert.ok(n.some((x) => x.electron && x.path.endsWith("/MacOS/WorkBuddy")));
  assert.equal(n[n.length - 1].path, "/usr/local/bin/node");
});

test("electronBesideCli rejects non-install layouts; cliNeedsNode / looksLikeElectron heuristics", () => {
  const env = winEnv([]);
  assert.equal(electronBesideCli(env, "C:\\Program Files\\nodejs\\codebuddy.cmd"), "");
  assert.equal(electronBesideCli(env, WIN_CLI), "C:\\Users\\me\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe");
  assert.equal(cliNeedsNode(WIN_CLI), true);
  assert.equal(cliNeedsNode("/usr/local/bin/codebuddy"), false);
  assert.equal(looksLikeElectron("C:\\x\\WorkBuddy.exe"), true);
  assert.equal(looksLikeElectron("C:\\x\\node.exe"), false);
});
