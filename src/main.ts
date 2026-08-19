import { FileSystemAdapter, MarkdownView, Notice, Plugin, WorkspaceLeaf, getLanguage, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, WorkBuddySettings } from "./settings/types";
import { WorkBuddySettingTab } from "./settings/WorkBuddySettingTab";
import { WorkBuddyView, VIEW_TYPE_WORKBUDDY } from "./view/WorkBuddyView";
import { WorkBuddyCliClient } from "./runtime/cliClient";
import { buildPrompt, buildSystemInstructions, resolveWorkingFolder } from "./runtime/context";
import { makeT, resolveLang, type Translate } from "./runtime/i18n";
import {
  Conversation,
  parseHistoryFile,
  removeConversation,
  serializeHistoryFile,
  upsertConversation
} from "./runtime/history";

export default class WorkBuddyPlugin extends Plugin {
  settings!: WorkBuddySettings;
  client!: WorkBuddyCliClient;
  /** Translator for the current UI language (rebuilt when the setting changes). */
  t!: Translate;

  /** Locally persisted chat history (newest first), loaded from history.json. */
  conversations: Conversation[] = [];

  /**
   * Last Markdown view that was actually focused, tracked via
   * `active-leaf-change`. `getActiveViewOfType(MarkdownView)` returns null
   * once focus moves into the sidebar chat input, which would silently drop
   * the "current note" attachment. This cache is the fallback.
   */
  private lastMarkdownView: MarkdownView | null = null;

  /**
   * Snapshot of the last non-empty selection seen in `lastMarkdownView`,
   * refreshed on every `selectionchange`, expiring 5s after the last related
   * activity (a new selection or typing in the chat input).
   */
  private lastSelectionSnapshot: { notePath?: string; text: string } | null = null;
  private selectionExpiryTimer: number | null = null;
  private static readonly SELECTION_EXPIRY_MS = 5000;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.rebuildTranslator();
    await this.loadHistory();
    this.client = new WorkBuddyCliClient(
      () => this.settings,
      () => this.t
    );

    this.registerView(VIEW_TYPE_WORKBUDDY, (leaf) => new WorkBuddyView(leaf, this));

    this.lastMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (this.lastMarkdownView) {
          const sel = this.captureViewSelection(this.lastMarkdownView);
          if (sel) this.setSelectionSnapshot({ notePath: this.lastMarkdownView.file?.path, text: sel });
        }
        const view = leaf?.view;
        if (view instanceof MarkdownView) this.lastMarkdownView = view;
      })
    );

    // Fires on every selection change (mouse drag, shift+arrow, ...). Only
    // stored when the selection lands inside the tracked Markdown view, so
    // selecting text in the chat log never overwrites a note selection.
    this.registerDomEvent(activeDocument, "selectionchange", () => {
      const view = this.lastMarkdownView;
      if (!view) return;
      const sel = this.captureViewSelection(view);
      if (sel) this.setSelectionSnapshot({ notePath: view.file?.path, text: sel });
    });

    this.addRibbonIcon("bot", this.t("cmd.ribbon"), () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-view",
      name: this.t("cmd.open"),
      callback: () => void this.activateView()
    });

    this.addCommand({
      id: "new-tab",
      name: this.t("cmd.newTab"),
      callback: async () => {
        const view = await this.activateView();
        view?.newTab();
      }
    });

    this.addCommand({
      id: "send-note",
      name: this.t("cmd.sendNote"),
      checkCallback: (checking) => {
        const mdView = this.getActiveMarkdownView();
        if (!mdView) return false;
        if (!checking) void this.sendNote(mdView);
        return true;
      }
    });

    this.addCommand({
      id: "send-selection",
      name: this.t("cmd.sendSelection"),
      // Not editorCheckCallback: that only sees the CodeMirror selection,
      // which stays empty for text highlighted in Reading View.
      checkCallback: (checking) => {
        const mdView = this.getActiveMarkdownView();
        if (!mdView) return false;
        const sel = this.captureViewSelection(mdView);
        if (!sel) return false;
        if (!checking) void this.sendSelection(mdView, sel);
        return true;
      }
    });

    this.addSettingTab(new WorkBuddySettingTab(this.app, this));
  }

  onunload(): void {
    // Obsidian detaches leaves automatically; make sure no CLI child survives.
    this.client?.abortAll();
    if (this.selectionExpiryTimer !== null) window.clearTimeout(this.selectionExpiryTimer);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<WorkBuddySettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** (Re)create the translator from the language setting + Obsidian's locale. */
  rebuildTranslator(): void {
    let hostLocale: string | null = null;
    try {
      hostLocale = getLanguage();
    } catch {
      hostLocale = null;
    }
    this.t = makeT(resolveLang(this.settings.language, hostLocale));
  }

  // ---- chat history persistence ----
  //
  // Stored in a separate `history.json` in the plugin folder (NOT data.json),
  // so settings stay small and history can grow independently.

  private historyPath(): string {
    return normalizePath(`${this.manifest.dir}/history.json`);
  }

  /** Load persisted conversations from disk (best effort; never throws). */
  async loadHistory(): Promise<void> {
    try {
      const p = this.historyPath();
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(p)) {
        this.conversations = parseHistoryFile(await adapter.read(p));
      }
    } catch {
      this.conversations = [];
    }
  }

  private async persistHistory(): Promise<void> {
    try {
      await this.app.vault.adapter.write(this.historyPath(), serializeHistoryFile(this.conversations));
    } catch {
      /* best effort - a failed history write must never break a chat turn */
    }
  }

  /** Insert or update a conversation, then persist. */
  async saveConversation(entry: Conversation): Promise<void> {
    this.conversations = upsertConversation(this.conversations, entry);
    await this.persistHistory();
  }

  /** Delete a conversation by id, then persist. */
  async deleteConversation(id: string): Promise<void> {
    this.conversations = removeConversation(this.conversations, id);
    await this.persistHistory();
  }

  /**
   * Get the active markdown editor view, if any. Falls back to the last
   * Markdown view that had focus (e.g. before the user clicked into the chat
   * input), as long as its leaf is still open.
   */
  getActiveMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;

    const fallback = this.lastMarkdownView;
    if (fallback && this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === fallback)) {
      return fallback;
    }
    return null;
  }

  /**
   * The editor selection to attach to a chat turn: a live read if a Markdown
   * view is genuinely focused right now, otherwise the snapshot captured when
   * focus last left an editor.
   */
  getCurrentSelection(): { notePath?: string; text: string } | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) {
      const sel = this.captureViewSelection(active);
      if (sel) return { notePath: active.file?.path, text: sel };
    }
    return this.lastSelectionSnapshot;
  }

  private setSelectionSnapshot(snap: { notePath?: string; text: string }): void {
    this.lastSelectionSnapshot = snap;
    this.scheduleSelectionExpiry();
  }

  private scheduleSelectionExpiry(): void {
    if (this.selectionExpiryTimer !== null) window.clearTimeout(this.selectionExpiryTimer);
    this.selectionExpiryTimer = window.setTimeout(() => {
      this.lastSelectionSnapshot = null;
      this.selectionExpiryTimer = null;
    }, WorkBuddyPlugin.SELECTION_EXPIRY_MS);
  }

  /** Typing in the chat input keeps a pending selection snapshot alive. */
  touchSelectionActivity(): void {
    if (this.lastSelectionSnapshot) this.scheduleSelectionExpiry();
  }

  /**
   * Read the currently highlighted text in a Markdown view, covering both
   * Reading View (rendered HTML - `window.getSelection()`) and Source / Live
   * Preview (CodeMirror - `editor.getSelection()`). The DOM selection only
   * counts when it lands inside this view's container.
   */
  private captureViewSelection(view: MarkdownView): string {
    try {
      const domSel = window.getSelection();
      if (domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
        const range = domSel.getRangeAt(0);
        if (view.containerEl.contains(range.commonAncestorContainer)) {
          const text = domSel.toString();
          if (text.trim()) return text;
        }
      }
    } catch {
      /* stay defensive */
    }
    try {
      return view.editor.getSelection();
    } catch {
      return "";
    }
  }

  /**
   * Absolute filesystem path of the vault root (the agent's default working
   * directory). Empty string if the vault is not on a local filesystem.
   */
  getVaultBasePath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }

  /** The child process cwd for a turn: vault root or the configured sub-folder. */
  getWorkingFolder(): string {
    return resolveWorkingFolder(this.getVaultBasePath(), this.settings.workingFolder || "");
  }

  /** The `--append-system-prompt` text for a turn. */
  getSystemPrompt(): string {
    return buildSystemInstructions(this.getWorkingFolder(), {
      markdownFormattingEnabled: this.settings.markdownFormattingPromptEnabled,
      customPrompt: this.settings.customSystemPrompt,
      vaultRoot: this.getVaultBasePath()
    });
  }

  /** Refresh the footer meta bar in every open view (after a settings change). */
  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKBUDDY)) {
      const view = leaf.view;
      if (view instanceof WorkBuddyView) view.refreshMetaBar();
    }
  }

  /** Rebuild the translator and re-render all open views (language change). */
  applyLanguageChange(): void {
    this.rebuildTranslator();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKBUDDY)) {
      const view = leaf.view;
      if (view instanceof WorkBuddyView) view.rerenderChrome();
    }
  }

  /** Reveal the chat view in the right sidebar and return it. */
  async activateView(): Promise<WorkBuddyView | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_WORKBUDDY);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_WORKBUDDY, active: true });
    }
    if (leaf) await workspace.revealLeaf(leaf);
    return (leaf?.view as WorkBuddyView) ?? null;
  }

  private async sendNote(mdView: MarkdownView): Promise<void> {
    const view = await this.activateView();
    if (!view) return;
    const notePath = mdView.file?.path;
    const noteContent = this.settings.includeNoteContent ? mdView.editor.getValue() : undefined;
    const display = this.t("view.reviewNote");
    const prompt = buildPrompt(display, { notePath, noteContent });
    view.submitPrompt(prompt, display, { notePath, noteContent });
  }

  private async sendSelection(mdView: MarkdownView, selection: string): Promise<void> {
    if (!selection) {
      new Notice(this.t("view.noSelection"));
      return;
    }
    const view = await this.activateView();
    if (!view) return;
    const notePath = mdView.file?.path;
    const display = this.t("view.reviewSelection");
    const prompt = buildPrompt(display, { notePath, selection });
    view.submitPrompt(prompt, display, { notePath, selection });
  }
}
