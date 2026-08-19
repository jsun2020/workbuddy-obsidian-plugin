// Build the prompt sent to WorkBuddy from the user's text plus optional note
// context, and the system-prompt addendum. Same XML-ish tag convention as the
// Hermes Agent / Claudian plugins - small, readable, model-friendly.

export interface NoteContext {
  notePath?: string;
  selection?: string;
  noteContent?: string;
}

export function buildPrompt(userText: string, ctx: NoteContext): string {
  const parts: string[] = [userText.trim()];

  if (ctx.selection && ctx.selection.trim()) {
    parts.push(
      [
        "<editor_selection>",
        `<file_path>${ctx.notePath ?? ""}</file_path>`,
        "<selection>",
        ctx.selection,
        "</selection>",
        "</editor_selection>"
      ].join("\n")
    );
  }

  if (ctx.noteContent && ctx.noteContent.trim()) {
    parts.push(
      [
        "<current_note>",
        `<file_path>${ctx.notePath ?? ""}</file_path>`,
        "<content>",
        ctx.noteContent,
        "</content>",
        "</current_note>"
      ].join("\n")
    );
  } else if (ctx.notePath) {
    parts.push(`<current_note>${ctx.notePath}</current_note>`);
  }

  return parts.filter(Boolean).join("\n\n");
}

// ---- agent working folder -------------------------------------------------

/**
 * True when `p` is an absolute path. A Windows drive (`C:\`) or UNC (`\\srv`)
 * is always absolute; a bare leading slash is absolute only on POSIX (inferred
 * from the vault base style) so that a Windows user typing "/Projects" gets a
 * vault sub-folder, not a drive-root path.
 */
function isAbsolutePath(p: string, base: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (/^\\\\/.test(p)) return true;
  if (/^\//.test(p)) return !base.includes("\\");
  return false;
}

/**
 * Resolve the agent's working folder (the child process cwd).
 * @param vaultBase  absolute path of the Obsidian vault root
 * @param configured the "working folder" setting (vault-relative, absolute, or empty)
 */
export function resolveWorkingFolder(vaultBase: string, configured: string): string {
  const base = (vaultBase || "").replace(/[\\/]+$/, "");
  const sub = (configured || "").trim();
  if (!sub) return base;
  if (isAbsolutePath(sub, base)) return sub.replace(/[\\/]+$/, "");
  if (!base) return sub;
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${sub.replace(/^[\\/]+/, "").replace(/[\\/]+/g, sep)}`;
}

/**
 * System-prompt addendum that tells WorkBuddy it is working inside an Obsidian
 * vault. The vault IS the process cwd, so file tools work with relative paths.
 */
export function vaultInstructions(folder: string, vaultRoot: string): string {
  const f = (folder || "").trim();
  if (!f) return "";
  const isRoot = !vaultRoot || f.replace(/[\\/]+$/, "").toLowerCase() === vaultRoot.replace(/[\\/]+$/, "").toLowerCase();
  return (
    `You are running inside the user's Obsidian vault${isRoot ? "" : " (sub-folder)"}. ` +
    `Your current working directory is ${f}. ` +
    `Notes are Markdown (.md) files; "my notes", "this folder" or "the vault" refer to this directory. ` +
    `Use the file read/search/edit tools with paths relative to this directory (or absolute paths under it) ` +
    `rather than shell commands. Keep Obsidian conventions when you edit notes: preserve YAML front matter, ` +
    `use [[wikilinks]] to link notes, and do not rename or delete notes unless explicitly asked. ` +
    `If a tool is denied by the current permission mode, do not retry it repeatedly - say what you would have ` +
    `done and suggest enabling "Allow editing notes" in the plugin settings.`
  );
}

/**
 * Reminds the model that its replies render through Obsidian's Markdown
 * renderer inside a narrow chat bubble.
 */
export function markdownFormattingInstructions(): string {
  return (
    `Your replies are rendered as Markdown inside a narrow Obsidian sidebar panel, ` +
    `so formatting choices matter. Fence code with triple backticks and a language tag, use "-" for ` +
    `bullet lists and "1." for ordered lists with a blank line before/after, use real Markdown tables ` +
    `instead of hand-aligned ASCII tables, wrap inline code/identifiers/paths in single backticks, and keep ` +
    `headings to "##" or lower. Prefer short paragraphs and lists over long blocks of prose. Don't wrap ` +
    `the entire reply in a code fence. Reply in the same language the user writes in.`
  );
}

export interface SystemInstructionOptions {
  /** Include the built-in Markdown-formatting reminder. Default true. */
  markdownFormattingEnabled?: boolean;
  /** User-authored text appended after the built-in instructions. */
  customPrompt?: string;
  /** Vault root, used to word the folder instructions. */
  vaultRoot?: string;
}

/**
 * Combine folder instructions, the optional Markdown reminder, and the user's
 * custom prompt into one string for `--append-system-prompt`.
 */
export function buildSystemInstructions(folder: string, opts: SystemInstructionOptions = {}): string {
  const parts = [vaultInstructions(folder, opts.vaultRoot || "")];
  if (opts.markdownFormattingEnabled !== false) parts.push(markdownFormattingInstructions());
  const custom = (opts.customPrompt || "").trim();
  if (custom) parts.push(custom);
  return parts.filter(Boolean).join("\n\n");
}
