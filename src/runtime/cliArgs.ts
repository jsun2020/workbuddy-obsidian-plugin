// Pure builder for the WorkBuddy CLI argument list - the ONE place that knows
// the flags (so a CLI update only ever touches this file). Unit-tested.

import type { PermissionMode, ReasoningEffort } from "../settings/types";

export interface CliArgOptions {
  permissionMode: PermissionMode;
  model?: string;
  effort?: ReasoningEffort;
  maxTurns?: number;
  /** Resume an existing WorkBuddy session (multi-turn continuity). */
  sessionId?: string;
  /** Appended to WorkBuddy's own system prompt. */
  systemPrompt?: string;
}

/**
 * Shell tools. In "edits" mode acceptEdits still exposes them to the model but
 * denies every call in non-interactive runs, so the model burns its turn on a
 * doomed Bash attempt. Removing them from the tool list up front makes the
 * model reach for Glob/Read/Grep instead.
 */
export const SHELL_TOOLS = ["Bash", "PowerShell"];

/**
 * Tools that can change the machine. In read-only mode they are removed from
 * the model's tool list up front (default mode would deny them anyway in
 * non-interactive runs, but the model then burns turns retrying).
 */
export const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", ...SHELL_TOOLS, "ImageGen"];

/** Map a permission mode to the CLI flags (verified behaviours, prd.md 3.2). */
export function permissionArgs(mode: PermissionMode): string[] {
  switch (mode) {
    case "readonly":
      return ["--permission-mode", "default", "--disallowedTools", WRITE_TOOLS.join(",")];
    case "full":
      return ["--permission-mode", "bypassPermissions"];
    case "edits":
    default:
      return ["--permission-mode", "acceptEdits", "--disallowedTools", SHELL_TOOLS.join(",")];
  }
}

/** Base args for one non-interactive turn fed over stdin as stream-json. */
export function buildCliArgs(opts: CliArgOptions): string[] {
  const args: string[] = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages"
  ];
  args.push(...permissionArgs(opts.permissionMode));
  const model = (opts.model || "").trim();
  if (model && model !== "auto") args.push("--model", model);
  const effort = (opts.effort || "").trim();
  if (effort) args.push("--effort", effort);
  if (opts.maxTurns && opts.maxTurns > 0) args.push("--max-turns", String(Math.floor(opts.maxTurns)));
  const sid = (opts.sessionId || "").trim();
  if (sid) args.push("--resume", sid);
  const sys = (opts.systemPrompt || "").trim();
  if (sys) args.push("--append-system-prompt", sys);
  return args;
}

/** The single stdin line for `--input-format stream-json`. */
export function buildStdinMessage(prompt: string): string {
  return (
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] }
    }) + "\n"
  );
}
