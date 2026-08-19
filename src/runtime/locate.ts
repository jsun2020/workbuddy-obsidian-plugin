// Locate WorkBuddy's bundled CLI and a Node runtime able to run it.
//
// Pure module: every filesystem/platform fact comes in through `LocateEnv`, so
// the search order is unit-testable without touching the disk. The plugin
// builds a real env from `os`/`fs`/`process` (see cliClient.ts).
//
// Facts this encodes (verified on Windows, WorkBuddy 5.2.6 — see prd.md 3.2):
//  - CLI:  <install>/resources/app.asar.unpacked/cli/bin/codebuddy  (a Node script)
//  - Node: ~/.workbuddy/binaries/node/versions/<ver>/node(.exe)  (downloaded by the app)
//          or the WorkBuddy executable itself with ELECTRON_RUN_AS_NODE=1
//          or `node` on PATH.
// macOS/Linux locations are best-effort guesses (A1 in prd.md) and overridable.

export type Platform = "win32" | "darwin" | "linux";

export interface LocateEnv {
  platform: Platform;
  /** User home directory. */
  home: string;
  /** %LOCALAPPDATA% on Windows (may be empty elsewhere). */
  localAppData: string;
  /** %ProgramFiles% on Windows (may be empty elsewhere). */
  programFiles: string;
  /** Directories from PATH, already split. */
  pathDirs: string[];
  /** File-existence probe (a directory counts as existing). */
  exists(p: string): boolean;
  /** Directory listing (names only); [] when missing/unreadable. */
  listDir(p: string): string[];
}

export interface NodeCandidate {
  path: string;
  /** True when `path` is the WorkBuddy/Electron executable (needs ELECTRON_RUN_AS_NODE=1). */
  electron: boolean;
  source: "override" | "bundled" | "electron" | "path";
}

export interface RuntimeResolution {
  cliPath: string | null;
  cliSource: "override" | "install" | "path" | null;
  node: NodeCandidate | null;
  /** Everything that was probed, for diagnostics in the settings tab. */
  triedCli: string[];
  triedNode: string[];
}

const CLI_REL_WIN = ["resources", "app.asar.unpacked", "cli", "bin", "codebuddy"];
const CLI_REL_MAC = ["Contents", "Resources", "app.asar.unpacked", "cli", "bin", "codebuddy"];

function join(env: LocateEnv, ...parts: string[]): string {
  const sep = env.platform === "win32" ? "\\" : "/";
  return parts
    .filter((p) => p !== "")
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join(sep);
}

/** Candidate CLI script paths, in priority order (install locations first, then PATH shims). */
export function cliCandidates(env: LocateEnv): string[] {
  const out: string[] = [];
  if (env.platform === "win32") {
    if (env.localAppData) out.push(join(env, env.localAppData, "Programs", "WorkBuddy", ...CLI_REL_WIN));
    if (env.programFiles) out.push(join(env, env.programFiles, "WorkBuddy", ...CLI_REL_WIN));
    // Some installers put per-user apps directly under %LOCALAPPDATA%.
    if (env.localAppData) out.push(join(env, env.localAppData, "WorkBuddy", ...CLI_REL_WIN));
  } else if (env.platform === "darwin") {
    out.push(join(env, "/Applications", "WorkBuddy.app", ...CLI_REL_MAC));
    out.push(join(env, env.home, "Applications", "WorkBuddy.app", ...CLI_REL_MAC));
  } else {
    out.push(join(env, "/opt", "WorkBuddy", ...CLI_REL_WIN));
    out.push(join(env, "/usr", "lib", "workbuddy", ...CLI_REL_WIN));
    out.push(join(env, env.home, ".local", "share", "WorkBuddy", ...CLI_REL_WIN));
  }
  // Last resort: a globally installed CodeBuddy Code CLI (same protocol, but
  // it uses ~/.codebuddy and its own login rather than WorkBuddy's).
  for (const dir of env.pathDirs) {
    if (!dir) continue;
    if (env.platform === "win32") {
      out.push(join(env, dir, "codebuddy.cmd"));
    } else {
      out.push(join(env, dir, "codebuddy"));
    }
  }
  return dedupe(out);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Parse "22.22.2" -> [22,22,2]; unparsable -> []. */
function versionKey(name: string): number[] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(name);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [];
}

function compareVersionsDesc(a: string, b: string): number {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < 3; i++) {
    const d = (kb[i] ?? -1) - (ka[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The WorkBuddy executable that sits beside a CLI found at an install location
 * (`<install>/WorkBuddy.exe` on Windows, `WorkBuddy.app/Contents/MacOS/WorkBuddy`
 * on macOS, `<install>/workbuddy` on Linux). Returns "" when the CLI path does
 * not look like an install layout (e.g. a PATH shim).
 */
export function electronBesideCli(env: LocateEnv, cliPath: string): string {
  const parts = cliPath.split(/[\\/]+/);
  // .../resources/app.asar.unpacked/cli/bin/codebuddy  -> strip 5 segments
  if (parts.length < 6) return "";
  const tail = parts.slice(-5).map((p) => p.toLowerCase());
  const expect = ["resources", "app.asar.unpacked", "cli", "bin", "codebuddy"];
  if (tail.join("/") !== expect.join("/")) return "";
  const installParts = parts.slice(0, -5);
  if (env.platform === "win32") return join(env, installParts.join("\\"), "WorkBuddy.exe");
  if (env.platform === "darwin") {
    // installParts ends with ".../WorkBuddy.app/Contents"
    return join(env, installParts.join("/"), "MacOS", "WorkBuddy");
  }
  return join(env, installParts.join("/"), "workbuddy");
}

/** Candidate Node runtimes, in priority order. */
export function nodeCandidates(env: LocateEnv, cliPath: string | null): NodeCandidate[] {
  const out: NodeCandidate[] = [];
  const exe = env.platform === "win32" ? "node.exe" : "node";

  // 1. The Node that the WorkBuddy app downloads for itself.
  const versionsDir = join(env, env.home, ".workbuddy", "binaries", "node", "versions");
  const versions = env.listDir(versionsDir).filter((n) => versionKey(n).length === 3);
  versions.sort(compareVersionsDesc);
  for (const v of versions) {
    out.push({ path: join(env, versionsDir, v, exe), electron: false, source: "bundled" });
    if (env.platform !== "win32") {
      out.push({ path: join(env, versionsDir, v, "bin", exe), electron: false, source: "bundled" });
    }
  }

  // 2. The WorkBuddy executable itself (Electron doubles as Node).
  if (cliPath) {
    const electron = electronBesideCli(env, cliPath);
    if (electron) out.push({ path: electron, electron: true, source: "electron" });
  }

  // 3. node on PATH.
  for (const dir of env.pathDirs) {
    if (!dir) continue;
    out.push({ path: join(env, dir, exe), electron: false, source: "path" });
  }
  return out;
}

/**
 * Resolve CLI + runtime. Overrides (from settings) are trusted if they exist;
 * a non-existent override is reported in `tried*` and auto-detection proceeds
 * so one typo does not brick the plugin.
 */
export function resolveRuntime(
  env: LocateEnv,
  overrides: { cliPath?: string; nodePath?: string } = {}
): RuntimeResolution {
  const triedCli: string[] = [];
  const triedNode: string[] = [];

  let cliPath: string | null = null;
  let cliSource: RuntimeResolution["cliSource"] = null;

  const cliOverride = (overrides.cliPath || "").trim();
  if (cliOverride) {
    triedCli.push(cliOverride);
    if (env.exists(cliOverride)) {
      cliPath = cliOverride;
      cliSource = "override";
    }
  }
  if (!cliPath) {
    const candidates = cliCandidates(env);
    for (const c of candidates) {
      triedCli.push(c);
      if (env.exists(c)) {
        cliPath = c;
        cliSource = isPathShim(env, c) ? "path" : "install";
        break;
      }
    }
  }

  let node: NodeCandidate | null = null;
  const nodeOverride = (overrides.nodePath || "").trim();
  if (nodeOverride) {
    triedNode.push(nodeOverride);
    if (env.exists(nodeOverride)) {
      node = { path: nodeOverride, electron: looksLikeElectron(nodeOverride), source: "override" };
    }
  }
  if (!node) {
    for (const c of nodeCandidates(env, cliPath)) {
      triedNode.push(c.path);
      if (env.exists(c.path)) {
        node = c;
        break;
      }
    }
  }

  return { cliPath, cliSource, node, triedCli, triedNode };
}

function isPathShim(env: LocateEnv, p: string): boolean {
  const lower = p.toLowerCase();
  return env.pathDirs.some((d) => d && lower.startsWith(d.toLowerCase().replace(/[\\/]+$/, "")));
}

/** Heuristic for a user-supplied runtime override: the app binary vs a plain node. */
export function looksLikeElectron(p: string): boolean {
  const base = p.split(/[\\/]+/).pop() || "";
  return /^workbuddy(\.exe)?$/i.test(base) || /electron/i.test(base);
}

/**
 * A PATH-style shim (`codebuddy.cmd` / `codebuddy` shell wrapper) must be run
 * directly, not through Node. Install-layout CLIs are Node scripts.
 */
export function cliNeedsNode(cliPath: string): boolean {
  const base = (cliPath.split(/[\\/]+/).pop() || "").toLowerCase();
  if (base.endsWith(".cmd") || base.endsWith(".bat") || base.endsWith(".ps1")) return false;
  // Install layout: .../cli/bin/codebuddy  -> Node script.
  return /[\\/]cli[\\/]bin[\\/]codebuddy$/i.test(cliPath) || base.endsWith(".js") || base.endsWith(".mjs");
}
