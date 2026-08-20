// WorkBuddyCliClient - runs one WorkBuddy CLI process per chat turn.
//
// Obsidian desktop plugins execute in an Electron renderer with Node
// integration, so `child_process` is available (this is how the Claudian
// plugin drives the `claude` CLI). Each turn:
//   spawn(node, [cli, ...buildCliArgs()], { cwd: workingFolder })
//   stdin  <- one stream-json user message, then EOF
//   stdout -> StreamJsonParser -> callbacks
//   exit   -> onDone(sessionId) / onError(message)
// Multi-turn continuity comes from `--resume <session_id>`.

import { spawn, execFile, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildCliArgs, buildStdinMessage } from "./cliArgs";
import { cliNeedsNode, resolveRuntime, type LocateEnv, type RuntimeResolution } from "./locate";
import { buildDenyResponse, classifyError, StreamJsonParser, type StreamEvent } from "./protocol";
import type { WorkBuddySettings } from "../settings/types";
import type { Translate } from "./i18n";

export interface ChatCallbacks {
  onEvent: (e: StreamEvent) => void;
  onError: (message: string) => void;
  onDone: (sessionId: string | undefined) => void;
}

export interface ChatHandle {
  abort(): void;
}

export interface SendOptions {
  prompt: string;
  sessionId?: string;
  /** Child process working directory (the vault or a sub-folder). */
  cwd: string;
  /** Appended to the system prompt. */
  systemPrompt: string;
}

export interface InstallCheck {
  ok: boolean;
  cliPath: string | null;
  nodePath: string | null;
  /** "electron" when the runtime is WorkBuddy.exe itself. */
  runtimeKind: string;
  version: string;
  error: string;
  resolution: RuntimeResolution;
}

/** Build the real LocateEnv from the host process. */
export function hostLocateEnv(): LocateEnv {
  const platform: LocateEnv["platform"] =
    process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
  const pathVar = process.env.PATH || process.env.Path || "";
  return {
    platform,
    home: os.homedir(),
    localAppData: process.env.LOCALAPPDATA || "",
    programFiles: process.env.ProgramFiles || process.env["ProgramFiles(x86)"] || "",
    pathDirs: pathVar.split(path.delimiter).filter(Boolean),
    exists: (p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
    listDir: (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    }
  };
}

const STDERR_CAP = 8000;


export class WorkBuddyCliClient {
  private readonly getSettings: () => WorkBuddySettings;
  private readonly getT: () => Translate;
  /** Live children, so the plugin can kill them all on unload. */
  private readonly live = new Set<ChildProcess>();

  constructor(getSettings: () => WorkBuddySettings, getT: () => Translate) {
    this.getSettings = getSettings;
    this.getT = getT;
  }

  /** Resolve CLI + runtime from settings overrides and the host environment. */
  resolve(): RuntimeResolution {
    const s = this.getSettings();
    return resolveRuntime(hostLocateEnv(), { cliPath: s.cliPath, nodePath: s.nodePath });
  }

  /**
   * The command + args + env to launch the CLI with `extraArgs`, or an error
   * key when nothing usable was found. Shared by sendMessage() and checkInstall().
   */
  private launchSpec(
    extraArgs: string[]
  ): { cmd: string; args: string[]; env: NodeJS.ProcessEnv; resolution: RuntimeResolution } | { errorKey: string; resolution: RuntimeResolution } {
    const resolution = this.resolve();
    if (!resolution.cliPath) return { errorKey: "err.cliNotFound", resolution };
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Never leak Electron's own node-mode flag into a real node; set it only
    // when the runtime IS the WorkBuddy/Electron executable.
    delete env.ELECTRON_RUN_AS_NODE;
    if (cliNeedsNode(resolution.cliPath)) {
      if (!resolution.node) return { errorKey: "err.nodeNotFound", resolution };
      if (resolution.node.electron) env.ELECTRON_RUN_AS_NODE = "1";
      return { cmd: resolution.node.path, args: [resolution.cliPath, ...extraArgs], env, resolution };
    }
    // PATH shim (codebuddy.cmd / shell wrapper): run directly.
    return { cmd: resolution.cliPath, args: extraArgs, env, resolution };
  }

  /** Run `--version` to prove the CLI + runtime actually work together. */
  checkInstall(timeoutMs = 30000): Promise<InstallCheck> {
    const spec = this.launchSpec(["--version"]);
    if ("errorKey" in spec) {
      return Promise.resolve({
        ok: false,
        cliPath: spec.resolution.cliPath,
        nodePath: spec.resolution.node?.path ?? null,
        runtimeKind: spec.resolution.node?.source ?? "",
        version: "",
        error: this.getT()(spec.errorKey),
        resolution: spec.resolution
      });
    }
    const base: Omit<InstallCheck, "ok" | "version" | "error"> = {
      cliPath: spec.resolution.cliPath,
      nodePath: spec.resolution.node?.path ?? spec.cmd,
      runtimeKind: spec.resolution.node?.source ?? "direct",
      resolution: spec.resolution
    };
    return new Promise((resolve) => {
      // Windows: a .cmd shim needs a shell; a node/exe runtime does not.
      const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(spec.cmd);
      execFile(
        spec.cmd,
        spec.args,
        { env: spec.env, timeout: timeoutMs, windowsHide: true, shell: viaShell, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          const out = String(stdout || "").trim();
          if (err && !out) {
            resolve({ ...base, ok: false, version: "", error: (String(stderr || "").trim() || err.message).slice(0, 500) });
            return;
          }
          const m = /(\d+\.\d+\.\d+)/.exec(out);
          resolve({ ...base, ok: true, version: m ? m[1] : out.split(/\r?\n/)[0], error: "" });
        }
      );
    });
  }

  /** Start one turn. Returns a handle whose abort() kills the process. */
  sendMessage(opts: SendOptions, cb: ChatCallbacks): ChatHandle {
    const s = this.getSettings();
    const t = this.getT();
    const args = buildCliArgs({
      permissionMode: s.permissionMode,
      model: s.model,
      effort: s.reasoningEffort,
      maxTurns: s.maxTurns,
      sessionId: opts.sessionId,
      systemPrompt: opts.systemPrompt
    });
    const spec = this.launchSpec(args);
    if ("errorKey" in spec) {
      const key = spec.errorKey;
      // Defer so the caller's handle is wired up before the callback fires.
      window.setTimeout(() => cb.onError(t(key)), 0);
      return { abort: () => undefined };
    }

    let child: ChildProcess;
    try {
      const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(spec.cmd);
      child = spawn(spec.cmd, spec.args, {
        cwd: opts.cwd || undefined,
        env: spec.env,
        windowsHide: true,
        shell: viaShell,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (e) {
      window.setTimeout(() => cb.onError(t("err.spawn", { err: (e as Error)?.message || String(e) })), 0);
      return { abort: () => undefined };
    }
    this.live.add(child);

    const parser = new StreamJsonParser(opts.cwd || "");
    let stderrBuf = "";
    let finished = false;
    let aborted = false;
    let sawResult: { isError: boolean; text: string; sessionId: string } | null = null;
    let initSessionId = "";
    let idleTimer: number | null = null;
    const idleMs = Math.max(30, s.idleTimeoutSec || 600) * 1000;

    const clearIdle = () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    const armIdle = () => {
      clearIdle();
      idleTimer = window.setTimeout(() => {
        if (finished) return;
        finish(t("err.timeout", { sec: Math.round(idleMs / 1000) }));
        killTree(child);
      }, idleMs);
    };

    const finish = (errorMessage?: string) => {
      if (finished) return;
      finished = true;
      clearIdle();
      this.live.delete(child);
      if (aborted) return; // the view already handled the stop
      if (errorMessage) cb.onError(errorMessage);
      else cb.onDone(sawResult?.sessionId || initSessionId || opts.sessionId);
    };

    const handleEvents = (events: StreamEvent[]) => {
      if (finished || aborted) return;
      for (const ev of events) {
        if (ev.kind === "init" && ev.sessionId) initSessionId = ev.sessionId;
        if (ev.kind === "perm_request") {
          // In stream-json input mode a gated tool is NOT silently denied: the
          // CLI blocks on a can_use_tool control_request until stdin answers
          // (forever, even past stdin EOF). Deny so the turn continues with
          // the allowed tools; the CLI then emits a normal is_error
          // tool_result and the model keeps going.
          try {
            child.stdin?.write(
              buildDenyResponse(
                ev.requestId,
                "This tool is blocked by the user's WorkBuddy permission mode in Obsidian. Do not retry it; continue with the tools you are allowed to use."
              ),
              "utf8"
            );
          } catch {
            // child already gone - the close handler reports the outcome
          }
          continue; // internal plumbing, not a UI event
        }
        if (ev.kind === "result") {
          sawResult = { isError: ev.isError, text: ev.text, sessionId: ev.sessionId };
          // The CLI waits for further stream-json input after the result;
          // close stdin so it exits (verified live).
          try {
            child.stdin?.end();
          } catch {
            // already closed
          }
        }
        cb.onEvent(ev);
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      armIdle();
      handleEvents(parser.feed(chunk));
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderrBuf.length < STDERR_CAP) stderrBuf += chunk;
    });
    child.on("error", (err) => {
      finish(t("err.spawn", { err: err.message }));
    });
    child.on("close", (code) => {
      handleEvents(parser.flush());
      if (aborted || finished) {
        finish();
        return;
      }
      const detail = stderrBuf.trim().split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
      if (sawResult && sawResult.isError) {
        const raw = (sawResult.text || detail || "").trim();
        finish(classifyError(raw) === "auth" ? t("err.auth") : t("err.generic", { err: raw || `exit ${code ?? "?"}` }));
        return;
      }
      if (!sawResult) {
        const raw = detail || "";
        if (classifyError(raw) === "auth") {
          finish(t("err.auth"));
        } else if (code === 0 && !raw) {
          // Ended cleanly without a result line (should not happen) - treat as done.
          finish();
        } else {
          finish(t("err.exit", { code: String(code ?? "?"), detail: raw }));
        }
        return;
      }
      finish();
    });

    // Feed the prompt. stdin stays OPEN: the CLI may ask permission questions
    // over the control channel mid-turn (answered in handleEvents), and it is
    // closed when the result event arrives so the CLI exits.
    try {
      child.stdin?.on("error", () => undefined); // EPIPE if the child dies early
      child.stdin?.write(buildStdinMessage(opts.prompt), "utf8");
    } catch (e) {
      finish(t("err.spawn", { err: (e as Error)?.message || String(e) }));
      killTree(child);
    }
    armIdle();

    return {
      abort: () => {
        if (finished) return;
        aborted = true;
        finished = true;
        clearIdle();
        this.live.delete(child);
        killTree(child);
      }
    };
  }

  /** Kill every running turn (plugin unload). */
  abortAll(): void {
    for (const c of Array.from(this.live)) killTree(c);
    this.live.clear();
  }
}

/**
 * Kill a child and its descendants. The CLI spawns helpers (shell, MCP
 * servers), so on Windows `taskkill /T` is needed; `child.kill()` alone leaves
 * orphans. Best effort, never throws.
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  try {
    if (process.platform === "win32" && pid) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}
