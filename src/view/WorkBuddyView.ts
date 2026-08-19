// WorkBuddyView - the sidebar chat panel with a multi-tab manager.
//
// Pure Obsidian DOM API (no React), same shape as the Hermes Agent plugin.
// Each tab owns its own conversation state, messages container, and in-flight
// handle. Transport is the WorkBuddy CLI (runtime/cliClient.ts).

import { App, ItemView, WorkspaceLeaf, MarkdownRenderer, Menu, Modal, setIcon, Notice } from "obsidian";
import type WorkBuddyPlugin from "../main";
import { ChatHandle, WorkBuddyCliClient } from "../runtime/cliClient";
import type { NoteContext } from "../runtime/context";
import type { StreamEvent } from "../runtime/protocol";
import {
  Conversation,
  StoredMessage,
  deriveTitle,
  lastMessagePreview,
  relativeTimeParts,
  tabLabel
} from "../runtime/history";
import { EFFORT_OPTIONS, KNOWN_MODELS, type PermissionMode } from "../settings/types";

export const VIEW_TYPE_WORKBUDDY = "workbuddy-chat";

/** "842 chars" / "3.4k chars" - a rough size label for an attachment chip. */
function formatAttachmentSize(chars: number): string {
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : `${chars}`;
}

/** Minimal shape of Electron's remote dialog, obtained via require("electron"). */
interface ElectronRemote {
  dialog: {
    showOpenDialog(opts: {
      properties: string[];
      title?: string;
      defaultPath?: string;
    }): Promise<{ canceled: boolean; filePaths: string[] }>;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** UI-only rendering hint for one message: display text + collapsed attachments. */
interface MessageUiMeta {
  display?: string;
  ctx?: NoteContext;
}

interface AssistantEls {
  contentEl: HTMLElement;
  reasoningEl: HTMLElement;
  reasoningBodyEl: HTMLElement;
  toolsEl: HTMLElement;
  usageEl: HTMLElement;
  actionsEl: HTMLElement;
}

interface Tab {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** Parallel to `messages`: display text + attachment chips for user entries. */
  uiMeta: (MessageUiMeta | undefined)[];
  /** WorkBuddy session id (for --resume). */
  sessionId?: string;
  handle: ChatHandle | null;
  bodyEl: HTMLElement;
  tabButtonEl: HTMLElement;
  greeting?: string;
  historyId: string;
}

export class WorkBuddyView extends ItemView {
  private plugin: WorkBuddyPlugin;
  private client: WorkBuddyCliClient;

  private headerTitleEl!: HTMLElement;
  private historyBtn!: HTMLElement;
  private newTabBtn!: HTMLElement;
  private tabBarEl!: HTMLElement;
  private bodyHostEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private includeNoteToggle!: HTMLInputElement;
  private includeNoteLabelEl!: HTMLElement;
  private includeSelectionToggle!: HTMLInputElement;
  private includeSelectionLabelEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private metaModelEl!: HTMLElement;
  private metaThinkingEl!: HTMLElement;
  private metaPermEl!: HTMLElement;
  private folderChipEl!: HTMLElement;
  private folderLabelEl!: HTMLElement;

  private tabs: Tab[] = [];
  private activeTabId = "";
  private tabSeq = 0;

  constructor(leaf: WorkspaceLeaf, plugin: WorkBuddyPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.client = plugin.client;
  }

  getViewType(): string {
    return VIEW_TYPE_WORKBUDDY;
  }
  getDisplayText(): string {
    return "WorkBuddy";
  }
  getIcon(): string {
    return "bot";
  }

  /** Translate a UI string (public so the history modal can share it). */
  t(key: string, vars?: Record<string, string | number>): string {
    return this.plugin.t(key, vars);
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("workbuddy-view");

    // Header
    const header = root.createDiv({ cls: "workbuddy-header" });
    this.headerTitleEl = header.createSpan({ cls: "workbuddy-title", text: this.t("view.title") });
    const headerActions = header.createDiv({ cls: "workbuddy-header-actions" });
    this.historyBtn = headerActions.createEl("button", {
      cls: "workbuddy-icon-btn",
      attr: { "aria-label": this.t("view.history") }
    });
    setIcon(this.historyBtn, "history");
    this.historyBtn.onclick = () => this.openHistory();
    this.newTabBtn = headerActions.createEl("button", {
      cls: "workbuddy-icon-btn",
      attr: { "aria-label": this.t("view.newTab") }
    });
    setIcon(this.newTabBtn, "plus");
    this.newTabBtn.onclick = () => this.newTab();

    // Tab bar
    this.tabBarEl = root.createDiv({ cls: "workbuddy-tabbar" });

    // Body host (per-tab bodies live here)
    this.bodyHostEl = root.createDiv({ cls: "workbuddy-body-host" });

    // Context toggles
    const ctxRow = root.createDiv({ cls: "workbuddy-context-row" });
    const noteLabel = ctxRow.createEl("label", { cls: "workbuddy-context-toggle" });
    this.includeNoteToggle = noteLabel.createEl("input", { type: "checkbox" });
    this.includeNoteLabelEl = noteLabel.createSpan({ text: " " + this.t("view.currentNote") });
    const selLabel = ctxRow.createEl("label", { cls: "workbuddy-context-toggle" });
    this.includeSelectionToggle = selLabel.createEl("input", { type: "checkbox" });
    this.includeSelectionLabelEl = selLabel.createSpan({ text: " " + this.t("view.selection") });

    // Input
    const inputWrap = root.createDiv({ cls: "workbuddy-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "workbuddy-input",
      attr: { rows: "3", placeholder: this.t("view.placeholder") }
    });
    this.inputEl.addEventListener("keydown", (e) => {
      // Enter sends; Shift+Enter newline. While an IME composition (Chinese
      // input) is active, Enter confirms the candidate - never send then.
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.onSend();
      }
    });
    this.inputEl.addEventListener("input", () => this.plugin.touchSelectionActivity());
    const inputActions = inputWrap.createDiv({ cls: "workbuddy-input-actions" });

    // Meta bar (model | thinking | permission | working folder)
    const metaEl = inputActions.createDiv({ cls: "workbuddy-input-meta" });

    this.metaModelEl = metaEl.createDiv({ cls: "workbuddy-meta-item workbuddy-meta-model" });
    this.metaModelEl.onclick = (e) => this.showModelMenu(e);

    this.metaThinkingEl = metaEl.createDiv({ cls: "workbuddy-meta-item workbuddy-meta-thinking" });
    this.metaThinkingEl.onclick = (e) => this.showThinkingMenu(e);

    this.metaPermEl = metaEl.createDiv({ cls: "workbuddy-meta-item workbuddy-meta-perm" });
    this.metaPermEl.onclick = (e) => this.showPermissionMenu(e);

    this.folderChipEl = metaEl.createDiv({ cls: "workbuddy-folder-chip" });
    const folderIcon = this.folderChipEl.createSpan({ cls: "workbuddy-folder-icon" });
    setIcon(folderIcon, "folder");
    this.folderLabelEl = this.folderChipEl.createSpan({ cls: "workbuddy-folder-label" });
    this.folderChipEl.onclick = () => void this.pickWorkingFolder();

    const rightEl = inputActions.createDiv({ cls: "workbuddy-input-actions-right" });
    this.statusEl = rightEl.createSpan({ cls: "workbuddy-status" });
    // Dual-purpose: "Send" while idle, "Stop" while a turn is streaming.
    this.sendBtn = rightEl.createEl("button", { cls: "workbuddy-send-btn mod-cta", text: this.t("view.send") });
    this.sendBtn.onclick = () => {
      if (this.activeTab()?.handle) this.stopActive();
      else void this.onSend();
    };

    this.newTab();
    this.refreshMetaBar();
  }

  async onClose(): Promise<void> {
    for (const t of this.tabs) t.handle?.abort();
  }

  /** Re-apply translated labels to the static chrome (language change). */
  rerenderChrome(): void {
    if (!this.headerTitleEl) return;
    this.headerTitleEl.setText(this.t("view.title"));
    this.historyBtn.setAttr("aria-label", this.t("view.history"));
    this.newTabBtn.setAttr("aria-label", this.t("view.newTab"));
    this.includeNoteLabelEl.setText(" " + this.t("view.currentNote"));
    this.includeSelectionLabelEl.setText(" " + this.t("view.selection"));
    this.inputEl.setAttr("placeholder", this.t("view.placeholder"));
    this.refreshRunningState();
    this.refreshMetaBar();
  }

  // ---- tab management ----

  newTab(): void {
    if (this.tabs.length >= Math.max(1, this.plugin.settings.maxTabs)) {
      new Notice(this.t("view.tabLimit", { n: this.plugin.settings.maxTabs }));
      return;
    }
    this.tabSeq += 1;
    const id = `tab-${Date.now()}-${this.tabSeq}`;
    const bodyEl = this.bodyHostEl.createDiv({ cls: "workbuddy-body" });
    const tabButtonEl = this.tabBarEl.createDiv({ cls: "workbuddy-tab" });
    const tab: Tab = {
      id,
      title: this.t("view.tab", { n: this.tabSeq }),
      messages: [],
      uiMeta: [],
      handle: null,
      bodyEl,
      tabButtonEl,
      historyId: id
    };
    this.renderGreeting(tab);

    const label = tabButtonEl.createSpan({ cls: "workbuddy-tab-label", text: tab.title });
    label.onclick = () => this.activateTab(id);
    const closeBtn = tabButtonEl.createSpan({ cls: "workbuddy-tab-close" });
    setIcon(closeBtn, "x");
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.closeTab(id);
    };

    this.tabs.push(tab);
    this.activateTab(id);
  }

  private activateTab(id: string): void {
    this.activeTabId = id;
    for (const t of this.tabs) {
      const active = t.id === id;
      t.bodyEl.toggleClass("is-active", active);
      t.tabButtonEl.toggleClass("is-active", active);
    }
    this.refreshRunningState();
    this.refreshMetaBar();
  }

  private closeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = this.tabs[idx];
    tab.handle?.abort();
    tab.bodyEl.remove();
    tab.tabButtonEl.remove();
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.newTab();
      return;
    }
    if (this.activeTabId === id) {
      this.activateTab(this.tabs[Math.max(0, idx - 1)].id);
    }
  }

  private activeTab(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  private refreshRunningState(): void {
    const running = !!this.activeTab()?.handle;
    this.sendBtn.setText(running ? this.t("view.stop") : this.t("view.send"));
    this.sendBtn.classList.toggle("is-running", running);
    this.statusEl.setText(running ? this.t("view.thinkingStatus") : "");
  }

  /** Refresh the footer meta bar. Public so the settings tab can refresh it live. */
  refreshMetaBar(): void {
    if (!this.folderChipEl) return;
    const s = this.plugin.settings;

    const model = (s.model || "").trim() || "auto";
    this.metaModelEl.setText(model);
    this.metaModelEl.setAttr("aria-label", this.t("view.modelLabel"));

    this.metaThinkingEl.empty();
    this.metaThinkingEl.createSpan({ cls: "workbuddy-meta-key", text: this.t("view.effort") });
    this.metaThinkingEl.createSpan({ cls: "workbuddy-meta-val", text: s.reasoningEffort || this.t("view.effortDefault") });
    this.metaThinkingEl.setAttr("aria-label", this.t("view.effortLabel"));

    this.metaPermEl.setText(this.t(`perm.${s.permissionMode}`));
    this.metaPermEl.setAttr("aria-label", this.t("view.permLabel") + "\n" + this.t(`perm.${s.permissionMode}.desc`));
    this.metaPermEl.toggleClass("is-full", s.permissionMode === "full");
    this.metaPermEl.toggleClass("is-readonly", s.permissionMode === "readonly");

    const folder = this.plugin.getWorkingFolder();
    const name = folder ? folder.split(/[\\/]/).filter(Boolean).pop() || folder : this.t("view.noFolder");
    this.folderLabelEl.setText(name);
    this.folderChipEl.setAttr("aria-label", this.t("view.folderLabel", { folder: folder || "-" }));
  }

  /** Render the empty-state greeting in a tab body (kept stable per tab). */
  private renderGreeting(tab: Tab): void {
    if (tab.messages.length > 0) return;
    if (!tab.greeting) {
      const name = (this.plugin.settings.userName || "").trim();
      const opts = name
        ? [this.t("view.greetingNamed", { name }), this.t("view.greeting1"), this.t("view.greeting2")]
        : [this.t("view.greeting1"), this.t("view.greeting2"), this.t("view.greeting3")];
      tab.greeting = opts[Math.floor(Math.random() * opts.length)];
    }
    const wrap = tab.bodyEl.createDiv({ cls: "workbuddy-greeting" });
    wrap.createDiv({ cls: "workbuddy-greeting-text", text: tab.greeting });
  }

  private clearGreeting(tab: Tab): void {
    tab.bodyEl.querySelector(".workbuddy-greeting")?.remove();
  }

  // ---- footer menus ----

  private showThinkingMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const current = this.plugin.settings.reasoningEffort || "";
    for (const value of EFFORT_OPTIONS) {
      menu.addItem((item) =>
        item
          .setTitle(value || this.t("view.effortDefault"))
          .setChecked(current === value)
          .onClick(async () => {
            this.plugin.settings.reasoningEffort = value;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          })
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private showModelMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const current = (this.plugin.settings.model || "").trim() || "auto";
    const known = KNOWN_MODELS.slice();
    if (!known.includes(current)) known.push(current);
    for (const id of known) {
      menu.addItem((item) =>
        item
          .setTitle(id === "auto" ? this.t("view.modelAuto") : id)
          .setChecked(current === id)
          .onClick(async () => {
            this.plugin.settings.model = id === "auto" ? "" : id;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          })
      );
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(this.t("view.modelCustom")).onClick(() => this.openPluginSettings()));
    menu.showAtMouseEvent(evt);
  }

  private showPermissionMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const current = this.plugin.settings.permissionMode;
    const modes: PermissionMode[] = ["readonly", "edits", "full"];
    for (const mode of modes) {
      menu.addItem((item) =>
        item
          .setTitle(this.t(`perm.${mode}`))
          .setChecked(current === mode)
          .onClick(async () => {
            this.plugin.settings.permissionMode = mode;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
            new Notice(`${this.t(`perm.${mode}`)}: ${this.t(`perm.${mode}.desc`)}`);
          })
      );
    }
    menu.showAtMouseEvent(evt);
  }

  /**
   * Open a native folder-selection dialog (Electron remote, when available)
   * and store the chosen folder as the agent's working directory.
   */
  private async pickWorkingFolder(): Promise<void> {
    let remote: ElectronRemote | undefined;
    try {
      const electron = (window as { require?: (mod: string) => unknown }).require?.("electron");
      remote = (electron as { remote?: ElectronRemote } | undefined)?.remote;
    } catch {
      remote = undefined;
    }
    if (!remote?.dialog?.showOpenDialog) {
      new Notice(this.t("view.folderPickerUnavailable"));
      this.openPluginSettings();
      return;
    }
    const base = this.plugin.getVaultBasePath();
    try {
      const result = await remote.dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: this.t("view.pickFolderTitle"),
        ...(base ? { defaultPath: base } : {})
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;
      const picked = result.filePaths[0];
      this.plugin.settings.workingFolder = this.toStoredFolder(picked, base);
      await this.plugin.saveSettings();
      this.plugin.refreshOpenViews();
      new Notice(this.t("view.folderPicked", { folder: picked }));
    } catch (e) {
      new Notice(this.t("view.folderPickerError", { err: (e as Error)?.message || String(e) }));
    }
  }

  /** Vault-relative when inside the vault, "" for the root, absolute otherwise. */
  private toStoredFolder(picked: string, base: string): string {
    const norm = (p: string) => p.replace(/[\\/]+$/, "");
    const p = norm(picked);
    const b = norm(base);
    if (!b) return p;
    if (p.toLowerCase() === b.toLowerCase()) return "";
    const sep = b.includes("\\") ? "\\" : "/";
    const prefix = (b + sep).toLowerCase();
    if (p.toLowerCase().startsWith(prefix)) return p.slice((b + sep).length);
    return p;
  }

  /** Open Obsidian settings on the WorkBuddy tab (best effort). */
  private openPluginSettings(): void {
    const settingApi = (this.app as unknown as {
      setting?: { open(): void; openTabById(id: string): void };
    }).setting;
    if (settingApi?.open) {
      settingApi.open();
      settingApi.openTabById?.("workbuddy");
    } else {
      new Notice(this.t("view.openSettingsHint"));
    }
  }

  // ---- sending ----

  /** Public entry used by commands: push a prepared prompt into the active tab. */
  submitPrompt(prompt: string, display?: string, ctx?: NoteContext): void {
    void this.runTurn(prompt, display, ctx);
  }

  private async onSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;

    let notePath: string | undefined;
    let selection: string | undefined;
    let noteContent: string | undefined;

    const mdView = this.plugin.getActiveMarkdownView();
    if (mdView) {
      notePath = mdView.file?.path;
      if (this.includeNoteToggle.checked) {
        noteContent = this.plugin.settings.includeNoteContent ? mdView.editor.getValue() : undefined;
      }
    }
    if (this.includeSelectionToggle.checked) {
      const sel = this.plugin.getCurrentSelection();
      if (sel) {
        selection = sel.text;
        if (!notePath) notePath = sel.notePath;
      }
    }

    const { buildPrompt } = await import("../runtime/context");
    const ctx: NoteContext = {
      notePath: this.includeNoteToggle.checked || this.includeSelectionToggle.checked ? notePath : undefined,
      selection,
      noteContent
    };
    const prompt = buildPrompt(text, ctx);
    this.inputEl.value = "";
    await this.runTurn(prompt, text, ctx);
  }

  /**
   * Run one conversation turn in the active tab.
   * @param prompt   the full prompt (with context) sent to WorkBuddy
   * @param display  optional shorter text to show as the user bubble
   * @param ctx      attached note/selection content, rendered as collapsed chips
   */
  private async runTurn(prompt: string, display?: string, ctx?: NoteContext): Promise<void> {
    const tab = this.activeTab();
    if (!tab) return;
    if (tab.handle) {
      new Notice(this.t("view.alreadyStreaming"));
      return;
    }

    this.clearGreeting(tab);
    this.renderUserMessage(tab, display ?? prompt, ctx);
    const assistant = this.createAssistantMessage(tab);

    tab.messages.push({ role: "user", content: prompt });
    tab.uiMeta.push(display !== undefined || ctx ? { display, ctx } : undefined);

    let buffer = "";
    let reasoning = "";
    let pendingFlush: number | null = null;
    let lastIn = 0;
    let lastOut = 0;
    const toolLines = new Map<string, HTMLElement>();

    // Coalesce renders: Markdown re-render per delta is expensive; ~30 fps is plenty.
    const flush = () => {
      if (pendingFlush !== null) return;
      pendingFlush = window.setTimeout(() => {
        pendingFlush = null;
        assistant.contentEl.empty();
        void MarkdownRenderer.render(this.app, buffer || "", assistant.contentEl, "", this);
        this.scrollToBottom(tab);
      }, 33);
    };
    const flushNow = () => {
      if (pendingFlush !== null) {
        window.clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      assistant.contentEl.empty();
      void MarkdownRenderer.render(this.app, buffer || "", assistant.contentEl, "", this);
      this.scrollToBottom(tab);
    };

    const finishTurn = (finalText: string, errorMsg?: string) => {
      tab.handle = null;
      if (errorMsg) {
        assistant.contentEl.createDiv({ cls: "workbuddy-error", text: errorMsg });
      }
      tab.messages.push({ role: "assistant", content: errorMsg ? `[error] ${errorMsg}` : finalText });
      tab.uiMeta.push(undefined);
      if (finalText.trim()) this.renderAssistantActions(assistant, finalText);
      if (lastIn || lastOut) assistant.usageEl.setText(this.t("view.usage", { in: lastIn, out: lastOut }));
      this.refreshRunningState();
      this.scrollToBottom(tab);
      this.saveTabHistory(tab);
    };

    tab.handle = this.client.sendMessage(
      {
        prompt,
        sessionId: tab.sessionId,
        cwd: this.plugin.getWorkingFolder(),
        systemPrompt: this.plugin.getSystemPrompt()
      },
      {
        onEvent: (e: StreamEvent) => {
          switch (e.kind) {
            case "init":
              if (e.sessionId) tab.sessionId = e.sessionId;
              break;
            case "text":
              buffer += e.text;
              flush();
              break;
            case "thinking":
              if (!this.plugin.settings.showThinking) break;
              reasoning += e.text;
              assistant.reasoningEl.classList.add("is-visible");
              assistant.reasoningBodyEl.setText(reasoning);
              this.scrollToBottom(tab);
              break;
            case "tool_start": {
              // Tool activity lines live above the reply text (the model's
              // interim text before a tool call stays in the same bubble).
              if (buffer.trim() && !buffer.endsWith("\n\n")) buffer += "\n\n";
              const line = this.renderToolLine(assistant, e.name, e.preview, "running");
              if (e.id) toolLines.set(e.id, line);
              this.scrollToBottom(tab);
              break;
            }
            case "tool_end": {
              const line = toolLines.get(e.id);
              if (line) this.updateToolLine(line, e.isError ? "failed" : "completed", e.preview);
              break;
            }
            case "usage":
              lastIn = e.inputTokens || lastIn;
              lastOut = e.outputTokens || lastOut;
              break;
            case "result":
              if (e.sessionId) tab.sessionId = e.sessionId;
              if (e.inputTokens) lastIn = e.inputTokens;
              if (e.outputTokens) lastOut = e.outputTokens;
              if (!buffer.trim() && e.text.trim() && !e.isError) {
                // Nothing streamed (e.g. partial events unsupported) - use the final text.
                buffer = e.text;
              }
              if (e.deniedTools.length > 0) {
                assistant.toolsEl.createDiv({
                  cls: "workbuddy-tool workbuddy-tool-failed",
                  text: this.t("view.toolDenied", { n: e.deniedTools.length })
                });
              }
              flushNow();
              break;
          }
        },
        onError: (msg) => {
          flushNow();
          finishTurn(buffer, msg);
        },
        onDone: (sessionId) => {
          if (sessionId) tab.sessionId = sessionId;
          flushNow();
          finishTurn(buffer);
        }
      }
    );

    this.refreshRunningState();
  }

  private stopActive(): void {
    const tab = this.activeTab();
    if (tab?.handle) {
      tab.handle.abort();
      tab.handle = null;
      const last = tab.bodyEl.querySelector(".workbuddy-msg-assistant:last-child .workbuddy-usage");
      if (last) last.setText(this.t("view.stopped"));
      this.refreshRunningState();
      this.saveTabHistory(tab);
    }
  }

  // ---- rendering helpers ----

  private renderUserMessage(tab: Tab, text: string, ctx?: NoteContext): void {
    const msg = tab.bodyEl.createDiv({ cls: "workbuddy-msg workbuddy-msg-user" });
    msg.createDiv({ cls: "workbuddy-msg-role", text: this.t("view.you") });
    msg.createDiv({ cls: "workbuddy-msg-content", text });
    if (ctx) this.renderAttachments(msg, ctx);
    this.scrollToBottom(tab);
  }

  /** Attached note/selection content as collapsed chips. */
  private renderAttachments(msg: HTMLElement, ctx: NoteContext): void {
    const chips: { label: string; body: string }[] = [];
    const baseName = (p?: string) => (p ? (p.split("/").pop() ?? p) : this.t("view.currentNoteFallback"));

    if (ctx.noteContent && ctx.noteContent.trim()) {
      chips.push({
        label: this.t("view.noteChip", { name: baseName(ctx.notePath), size: formatAttachmentSize(ctx.noteContent.length) }),
        body: ctx.noteContent
      });
    }
    if (ctx.selection && ctx.selection.trim()) {
      chips.push({
        label: this.t("view.selectionChip", { name: baseName(ctx.notePath), size: formatAttachmentSize(ctx.selection.length) }),
        body: ctx.selection
      });
    }

    for (const chip of chips) {
      const wrap = msg.createDiv({ cls: "workbuddy-attachment" });
      const titleEl = wrap.createDiv({ cls: "workbuddy-attachment-title", text: `> ${chip.label}` });
      const bodyEl = wrap.createDiv({ cls: "workbuddy-attachment-body" });
      bodyEl.setText(chip.body);
      titleEl.addEventListener("click", () => {
        const expanded = wrap.classList.toggle("is-expanded");
        titleEl.setText(`${expanded ? "v" : ">"} ${chip.label}`);
      });
    }
  }

  private createAssistantMessage(tab: Tab): AssistantEls {
    const msg = tab.bodyEl.createDiv({ cls: "workbuddy-msg workbuddy-msg-assistant" });
    msg.createDiv({ cls: "workbuddy-msg-role", text: this.t("view.assistant") });

    const reasoningEl = msg.createDiv({ cls: "workbuddy-reasoning" });
    const reasoningTitleEl = reasoningEl.createDiv({ cls: "workbuddy-reasoning-title", text: `> ${this.t("view.thinking")}` });
    const reasoningBodyEl = reasoningEl.createDiv({ cls: "workbuddy-reasoning-body" });
    reasoningTitleEl.addEventListener("click", () => {
      const expanded = reasoningEl.classList.toggle("is-expanded");
      reasoningTitleEl.setText(`${expanded ? "v" : ">"} ${this.t("view.thinking")}`);
    });

    const toolsEl = msg.createDiv({ cls: "workbuddy-tools" });
    const contentEl = msg.createDiv({ cls: "workbuddy-msg-content" });
    const usageEl = msg.createDiv({ cls: "workbuddy-usage" });
    const actionsEl = msg.createDiv({ cls: "workbuddy-msg-actions" });

    return { contentEl, reasoningEl, reasoningBodyEl, toolsEl, usageEl, actionsEl };
  }

  /** Copy / Insert-at-cursor buttons under a finished reply. */
  private renderAssistantActions(assistant: AssistantEls, text: string): void {
    assistant.actionsEl.empty();
    const copyBtn = assistant.actionsEl.createEl("button", { cls: "workbuddy-action-btn", attr: { "aria-label": this.t("view.copy") } });
    setIcon(copyBtn, "copy");
    copyBtn.createSpan({ text: " " + this.t("view.copy") });
    copyBtn.onclick = () => {
      void navigator.clipboard.writeText(text).then(() => new Notice(this.t("view.copied")));
    };
    const insertBtn = assistant.actionsEl.createEl("button", { cls: "workbuddy-action-btn", attr: { "aria-label": this.t("view.insert") } });
    setIcon(insertBtn, "file-input");
    insertBtn.createSpan({ text: " " + this.t("view.insert") });
    insertBtn.onclick = () => {
      const mdView = this.plugin.getActiveMarkdownView();
      if (!mdView) {
        new Notice(this.t("view.noEditor"));
        return;
      }
      mdView.editor.replaceSelection(text);
      new Notice(this.t("view.inserted"));
    };
  }

  private renderToolLine(assistant: AssistantEls, name: string, preview: string, status: "running" | "completed" | "failed"): HTMLElement {
    const line = assistant.toolsEl.createDiv({ cls: `workbuddy-tool workbuddy-tool-${status}` });
    const iconEl = line.createSpan({ cls: "workbuddy-tool-icon" });
    setIcon(iconEl, status === "completed" ? "check" : status === "failed" ? "x" : "loader");
    line.createSpan({ cls: "workbuddy-tool-name", text: ` ${name}` });
    if (preview) line.createSpan({ cls: "workbuddy-tool-preview", text: ` ${preview}` });
    return line;
  }

  private updateToolLine(line: HTMLElement, status: "completed" | "failed", resultPreview: string): void {
    line.removeClass("workbuddy-tool-running");
    line.addClass(`workbuddy-tool-${status}`);
    const iconEl = line.querySelector(".workbuddy-tool-icon");
    if (iconEl instanceof HTMLElement) {
      iconEl.empty();
      setIcon(iconEl, status === "completed" ? "check" : "x");
    }
    if (status === "failed" && resultPreview) line.setAttr("aria-label", resultPreview);
  }

  private scrollToBottom(tab: Tab): void {
    tab.bodyEl.scrollTop = tab.bodyEl.scrollHeight;
  }

  // ---- chat history ----

  private openHistory(): void {
    new HistoryModal(this.app, this).open();
  }

  getConversations(): Conversation[] {
    return this.plugin.conversations.slice();
  }

  /** Age label for the history modal. */
  relativeTimeLabel(nowMs: number, thenMs: number): string {
    const { unit, n } = relativeTimeParts(nowMs, thenMs);
    return unit === "justNow" ? this.t("time.justNow") : this.t(`time.${unit}`, { n });
  }

  previewLabel(messages: StoredMessage[]): string {
    return lastMessagePreview(messages, { you: this.t("view.you"), assistant: this.t("view.assistant") });
  }

  /** Persist the active tab's conversation after a completed (or failed) turn. */
  private saveTabHistory(tab: Tab): void {
    if (!tab.messages.length) return;
    const messages: StoredMessage[] = tab.messages.map((m, i) => {
      const meta = tab.uiMeta[i];
      const stored: StoredMessage = { role: m.role, content: m.content };
      if (meta?.display !== undefined) stored.display = meta.display;
      if (meta?.ctx && (meta.ctx.noteContent || meta.ctx.selection)) {
        stored.attachments = {
          notePath: meta.ctx.notePath,
          noteContent: meta.ctx.noteContent,
          selection: meta.ctx.selection
        };
      }
      return stored;
    });
    const entry: Conversation = {
      id: tab.historyId,
      title: deriveTitle(messages, this.t("history.newChat")),
      sessionId: tab.sessionId,
      updatedAt: Date.now(),
      messages
    };
    void this.plugin.saveConversation(entry);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.plugin.deleteConversation(id);
  }

  /**
   * Restore a saved conversation into a tab: reuse the active tab when it is
   * empty, otherwise open a fresh one. The WorkBuddy session id is restored so
   * the conversation continues server-side via --resume.
   */
  restoreConversation(id: string): void {
    const conv = this.plugin.conversations.find((c) => c.id === id);
    if (!conv) return;

    let tab = this.activeTab();
    if (!tab || tab.messages.length > 0) {
      const before = this.tabs.length;
      this.newTab();
      if (this.tabs.length === before) {
        new Notice(this.t("view.closeTabFirst"));
        return;
      }
      tab = this.activeTab();
    }
    if (!tab) return;

    tab.bodyEl.empty();
    tab.messages = conv.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    tab.uiMeta = conv.messages
      .filter((m) => m.role !== "system")
      .map((m) =>
        m.display !== undefined || m.attachments
          ? {
              display: m.display,
              ctx: m.attachments
                ? { notePath: m.attachments.notePath, noteContent: m.attachments.noteContent, selection: m.attachments.selection }
                : undefined
            }
          : undefined
      );
    tab.sessionId = conv.sessionId;
    tab.historyId = conv.id;
    tab.title = tabLabel(conv.title, this.t("view.tabDefault"));
    const labelEl = tab.tabButtonEl.querySelector(".workbuddy-tab-label");
    if (labelEl) labelEl.setText(tab.title);

    this.renderRestoredMessages(tab);
    this.activateTab(tab.id);
    this.refreshMetaBar();
  }

  private renderRestoredMessages(tab: Tab): void {
    tab.messages.forEach((m, i) => {
      if (m.role === "user") {
        const meta = tab.uiMeta[i];
        this.renderUserMessage(tab, meta?.display ?? m.content, meta?.ctx);
      } else {
        const assistant = this.createAssistantMessage(tab);
        const content = m.content || "";
        if (content.startsWith("[error] ")) {
          assistant.contentEl.createDiv({ cls: "workbuddy-error", text: content.slice("[error] ".length) });
        } else {
          void MarkdownRenderer.render(this.app, content, assistant.contentEl, "", this);
          if (content.trim()) this.renderAssistantActions(assistant, content);
        }
      }
    });
    this.scrollToBottom(tab);
  }
}

/** Modal listing saved conversations, with open + delete per row. */
class HistoryModal extends Modal {
  constructor(app: App, private view: WorkBuddyView) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const t = (k: string, v?: Record<string, string | number>) => this.view.t(k, v);
    contentEl.empty();
    contentEl.addClass("workbuddy-history-modal");
    contentEl.createEl("h3", { text: t("history.title") });

    const listEl = contentEl.createDiv({ cls: "workbuddy-history-list" });
    const emptyEl = contentEl.createDiv({ cls: "workbuddy-history-empty", text: t("history.empty") });

    const render = (): void => {
      listEl.empty();
      const items = this.view.getConversations();
      emptyEl.toggleClass("workbuddy-hidden", items.length > 0);
      const now = Date.now();
      for (const conv of items) {
        const row = listEl.createDiv({ cls: "workbuddy-history-row" });
        const main = row.createDiv({ cls: "workbuddy-history-main" });
        main.createDiv({ cls: "workbuddy-history-title", text: conv.title });
        const preview = this.view.previewLabel(conv.messages);
        if (preview) main.createDiv({ cls: "workbuddy-history-preview", text: preview });
        main.createDiv({
          cls: "workbuddy-history-meta",
          text: t("history.meta", { age: this.view.relativeTimeLabel(now, conv.updatedAt), n: conv.messages.length })
        });
        main.onclick = () => {
          this.view.restoreConversation(conv.id);
          this.close();
        };
        const del = row.createSpan({ cls: "workbuddy-history-del", attr: { "aria-label": t("history.delete") } });
        setIcon(del, "trash");
        del.onclick = async (e) => {
          e.stopPropagation();
          await this.view.deleteConversation(conv.id);
          render();
        };
      }
    };
    render();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
