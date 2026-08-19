// Plugin settings shape + defaults.

import type { LangSetting } from "../runtime/i18n";

/**
 * What WorkBuddy is allowed to do in the vault. Maps to CLI flags in
 * runtime/cliArgs.ts (verified against the real CLI, see prd.md 3.2):
 *  - readonly: `--permission-mode default` + the write/shell tools disallowed
 *    up front, so the model does not waste turns on denied calls.
 *  - edits:    `--permission-mode acceptEdits` (Write/Edit auto-approved in the
 *    working folder; shell still denied). Default.
 *  - full:     `--permission-mode bypassPermissions` (everything, incl. shell).
 */
export type PermissionMode = "readonly" | "edits" | "full";

export type ReasoningEffort = "" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface WorkBuddySettings {
  /** Full path to WorkBuddy's bundled `codebuddy` script. Empty -> auto-detect. */
  cliPath: string;
  /** Node runtime (or the WorkBuddy executable). Empty -> auto-detect. */
  nodePath: string;
  /** UI language. */
  language: LangSetting;
  /** Your name, used to personalize the empty-chat greeting. Optional. */
  userName: string;
  permissionMode: PermissionMode;
  /** Model id passed as `--model`. Empty -> WorkBuddy's default (auto). */
  model: string;
  /** `--effort` hint. Empty -> not passed. */
  reasoningEffort: ReasoningEffort;
  /** `--max-turns`. 0 -> not passed (no limit). */
  maxTurns: number;
  /** Working folder relative to the vault root (or absolute). Empty -> vault root. */
  workingFolder: string;
  /** When sending the current note, include its full text (not just the path). */
  includeNoteContent: boolean;
  /** Maximum number of concurrent chat tabs. */
  maxTabs: number;
  /** Abort a turn when the CLI is silent for this many seconds. */
  idleTimeoutSec: number;
  /** Built-in Markdown-formatting reminder in the system prompt. */
  markdownFormattingPromptEnabled: boolean;
  /** Free-text instructions appended to every turn's system prompt. */
  customSystemPrompt: string;
  /** Show the (collapsed) thinking trace above replies. */
  showThinking: boolean;
}

export const DEFAULT_SETTINGS: WorkBuddySettings = {
  cliPath: "",
  nodePath: "",
  language: "auto",
  userName: "",
  permissionMode: "edits",
  model: "",
  reasoningEffort: "",
  maxTurns: 0,
  workingFolder: "",
  includeNoteContent: true,
  maxTabs: 3,
  idleTimeoutSec: 600,
  markdownFormattingPromptEnabled: true,
  customSystemPrompt: "",
  showThinking: true
};

/** Models the CLI advertises in `--help` (2.106.4) plus "auto". Free text in settings still wins. */
export const KNOWN_MODELS: string[] = [
  "auto",
  "glm-5.1",
  "glm-5.0",
  "glm-5.0-turbo",
  "glm-5v-turbo",
  "glm-4.7",
  "kimi-k2.5",
  "minimax-m2.7",
  "deepseek-v3-2-volc"
];

export const EFFORT_OPTIONS: ReasoningEffort[] = ["", "minimal", "low", "medium", "high", "xhigh", "max"];
