// Tiny i18n table for the plugin UI (Simplified Chinese + English).
//
// Pure module (no Obsidian imports) so it is unit-testable. The plugin resolves
// the language once from the setting ("auto" -> Obsidian's own locale) and
// passes a `t()` function into the views. Unknown keys fall back to the key
// itself so a missing translation can never crash a render.

export type Lang = "en" | "zh";
export type LangSetting = "auto" | Lang;

type Entry = { en: string; zh: string };

const STRINGS: Record<string, Entry> = {
  // ---- view chrome ----
  "view.title": { en: "WorkBuddy", zh: "WorkBuddy" },
  "view.history": { en: "Chat history", zh: "聊天记录" },
  "view.newTab": { en: "New tab", zh: "新建对话" },
  "view.tab": { en: "Chat {n}", zh: "对话 {n}" },
  "view.tabDefault": { en: "Chat", zh: "对话" },
  "view.tabLimit": { en: "WorkBuddy: tab limit reached ({n}). Adjust it in settings.", zh: "WorkBuddy：对话标签已达上限（{n}），可在设置中调整。" },
  "view.closeTabFirst": { en: "WorkBuddy: close a tab first (tab limit reached).", zh: "WorkBuddy：请先关闭一个对话（已达上限）。" },
  "view.currentNote": { en: "current note", zh: "当前笔记" },
  "view.selection": { en: "selection", zh: "选中文本" },
  "view.placeholder": { en: "Message WorkBuddy... (Enter to send, Shift+Enter for newline)", zh: "给 WorkBuddy 发消息...（Enter 发送，Shift+Enter 换行）" },
  "view.send": { en: "Send", zh: "发送" },
  "view.stop": { en: "Stop", zh: "停止" },
  "view.thinkingStatus": { en: "WorkBuddy is working...", zh: "WorkBuddy 正在思考..." },
  "view.you": { en: "You", zh: "你" },
  "view.assistant": { en: "WorkBuddy", zh: "WorkBuddy" },
  "view.thinking": { en: "thinking", zh: "思考过程" },
  "view.copy": { en: "Copy", zh: "复制" },
  "view.copied": { en: "Copied to clipboard.", zh: "已复制到剪贴板。" },
  "view.insert": { en: "Insert at cursor", zh: "插入到光标处" },
  "view.inserted": { en: "Inserted into the note.", zh: "已插入到笔记。" },
  "view.noEditor": { en: "WorkBuddy: open a note in edit mode first.", zh: "WorkBuddy：请先在编辑模式下打开一篇笔记。" },
  "view.alreadyStreaming": { en: "WorkBuddy: a response is already streaming in this tab.", zh: "WorkBuddy：这个对话正在回复中。" },
  "view.stopped": { en: "Stopped.", zh: "已停止。" },
  "view.noteChip": { en: "note: {name} ({size})", zh: "笔记：{name}（{size}）" },
  "view.selectionChip": { en: "selection: {name} ({size})", zh: "选中：{name}（{size}）" },
  "view.currentNoteFallback": { en: "current note", zh: "当前笔记" },
  "view.modelLabel": { en: "Model: click to switch", zh: "模型：点击切换" },
  "view.modelAuto": { en: "auto (WorkBuddy default)", zh: "自动（WorkBuddy 默认）" },
  "view.modelCustom": { en: "Custom... (set in settings)", zh: "自定义...（在设置中填写）" },
  "view.effortLabel": { en: "Reasoning effort: click to change", zh: "思考深度：点击切换" },
  "view.effort": { en: "Thinking: ", zh: "思考：" },
  "view.effortDefault": { en: "default", zh: "默认" },
  "view.permLabel": { en: "Permission mode: click to change", zh: "权限模式：点击切换" },
  "view.folderLabel": { en: "Working folder: {folder}\nClick to choose a folder", zh: "工作目录：{folder}\n点击选择文件夹" },
  "view.folderPickerUnavailable": { en: "Native folder picker unavailable. Set the working folder in settings.", zh: "无法打开文件夹选择器，请在设置中填写工作目录。" },
  "view.folderPicked": { en: "WorkBuddy working folder: {folder}", zh: "WorkBuddy 工作目录：{folder}" },
  "view.folderPickerError": { en: "Could not open folder picker: {err}", zh: "无法打开文件夹选择器：{err}" },
  "view.pickFolderTitle": { en: "Select WorkBuddy working folder", zh: "选择 WorkBuddy 工作目录" },
  "view.openSettingsHint": { en: "Open Settings -> WorkBuddy to set the working folder.", zh: "请在 设置 -> WorkBuddy 中填写工作目录。" },
  "view.noFolder": { en: "(no folder)", zh: "（无目录）" },
  "view.usage": { en: "tokens: in {in} / out {out}", zh: "tokens：输入 {in} / 输出 {out}" },
  "view.toolDenied": { en: "{n} tool request(s) were denied by the current permission mode.", zh: "有 {n} 个工具请求被当前权限模式拒绝。" },
  "view.greeting1": { en: "What shall we work on?", zh: "今天想做点什么？" },
  "view.greeting2": { en: "Ask WorkBuddy about your notes.", zh: "问问 WorkBuddy 关于你的笔记。" },
  "view.greeting3": { en: "Select some text, then ask away.", zh: "选中一段文字，再向它提问。" },
  "view.greetingNamed": { en: "What's new, {name}?", zh: "{name}，今天想做点什么？" },
  "view.noSelection": { en: "WorkBuddy: no text selected.", zh: "WorkBuddy：没有选中文本。" },
  "view.reviewNote": { en: "Please review the current note.", zh: "请帮我看看这篇笔记。" },
  "view.reviewSelection": { en: "Please review the selected text.", zh: "请帮我看看选中的这段文字。" },

  // ---- history modal ----
  "history.title": { en: "Chat history", zh: "聊天记录" },
  "history.empty": { en: "No saved conversations yet.", zh: "还没有保存的对话。" },
  "history.meta": { en: "{age} - {n} messages", zh: "{age} · {n} 条消息" },
  "history.delete": { en: "Delete", zh: "删除" },
  "history.newChat": { en: "New chat", zh: "新对话" },
  "time.justNow": { en: "just now", zh: "刚刚" },
  "time.m": { en: "{n}m ago", zh: "{n} 分钟前" },
  "time.h": { en: "{n}h ago", zh: "{n} 小时前" },
  "time.d": { en: "{n}d ago", zh: "{n} 天前" },
  "time.w": { en: "{n}w ago", zh: "{n} 周前" },
  "time.mo": { en: "{n}mo ago", zh: "{n} 个月前" },
  "time.y": { en: "{n}y ago", zh: "{n} 年前" },

  // ---- permission modes ----
  "perm.readonly": { en: "Read only", zh: "只读" },
  "perm.edits": { en: "Allow editing notes", zh: "允许修改笔记" },
  "perm.full": { en: "Full access (runs commands)", zh: "完全访问（可运行命令）" },
  "perm.readonly.desc": { en: "WorkBuddy can read and search your notes but never changes them.", zh: "WorkBuddy 只能读取和搜索笔记，不会修改任何内容。" },
  "perm.edits.desc": { en: "WorkBuddy can read, create and edit notes inside the working folder. It cannot run shell commands. Recommended.", zh: "WorkBuddy 可以读取、新建和修改工作目录内的笔记，但不能运行命令。推荐。" },
  "perm.full.desc": { en: "WorkBuddy may also run terminal commands and access the web without asking. Only enable this if you understand the risk.", zh: "WorkBuddy 还可以不经确认地运行终端命令和访问网络。请仅在理解风险时开启。" },

  // ---- errors ----
  "err.cliNotFound": {
    en: "WorkBuddy was not found on this computer. Install WorkBuddy, open it once and sign in, then try again. If it is installed somewhere unusual, set the CLI path in the plugin settings.",
    zh: "没有在这台电脑上找到 WorkBuddy。请先安装 WorkBuddy，打开并登录一次后再试。如果安装在特殊位置，请在插件设置中填写 CLI 路径。"
  },
  "err.nodeNotFound": {
    en: "Could not find a Node.js runtime to run WorkBuddy's CLI. Open the WorkBuddy app once (it installs one), or set the Node path in the plugin settings.",
    zh: "找不到运行 WorkBuddy 命令行所需的 Node.js。请先打开一次 WorkBuddy 应用（它会自动安装），或在插件设置中填写 Node 路径。"
  },
  "err.auth": {
    en: "WorkBuddy is not signed in. Open the WorkBuddy app, sign in, then try again.",
    zh: "WorkBuddy 尚未登录。请打开 WorkBuddy 应用并登录后再试。"
  },
  "err.spawn": { en: "Could not start WorkBuddy: {err}", zh: "无法启动 WorkBuddy：{err}" },
  "err.exit": { en: "WorkBuddy exited unexpectedly (code {code}). {detail}", zh: "WorkBuddy 意外退出（代码 {code}）。{detail}" },
  "err.timeout": { en: "No response from WorkBuddy for {sec}s - stopped.", zh: "WorkBuddy 超过 {sec} 秒没有响应，已停止。" },
  "err.generic": { en: "WorkBuddy error: {err}", zh: "WorkBuddy 出错：{err}" },

  // ---- settings ----
  "set.install": { en: "WorkBuddy installation", zh: "WorkBuddy 安装" },
  "set.installDesc": {
    en: "The plugin runs the command-line tool bundled with the WorkBuddy app. Nothing to configure if WorkBuddy is installed in the default location and you have signed in once. WorkBuddy does not need to be open.",
    zh: "插件会调用 WorkBuddy 应用自带的命令行工具。只要 WorkBuddy 安装在默认位置并登录过一次，无需任何配置；使用时不需要打开 WorkBuddy 窗口。"
  },
  "set.check": { en: "Check WorkBuddy", zh: "检测 WorkBuddy" },
  "set.checkDesc": { en: "Locate WorkBuddy and verify it can run.", zh: "查找 WorkBuddy 并确认它可以运行。" },
  "set.checking": { en: "Checking...", zh: "检测中..." },
  "set.checkOk": { en: "OK - WorkBuddy CLI {version}\nCLI: {cli}\nRuntime: {node}", zh: "正常 - WorkBuddy CLI {version}\nCLI：{cli}\n运行时：{node}" },
  "set.checkFail": { en: "Failed: {err}", zh: "失败：{err}" },
  "set.cliPath": { en: "CLI path (advanced)", zh: "CLI 路径（高级）" },
  "set.cliPathDesc": { en: "Leave empty to auto-detect. Otherwise the full path to WorkBuddy's bundled 'codebuddy' script.", zh: "留空则自动检测。否则填写 WorkBuddy 自带 codebuddy 脚本的完整路径。" },
  "set.nodePath": { en: "Node runtime (advanced)", zh: "Node 运行时（高级）" },
  "set.nodePathDesc": { en: "Leave empty to auto-detect (WorkBuddy's bundled Node, then the WorkBuddy app itself, then PATH).", zh: "留空则自动检测（WorkBuddy 自带的 Node，其次 WorkBuddy 程序本身，再次系统 PATH）。" },
  "set.auto": { en: "(auto-detect)", zh: "（自动检测）" },
  "set.language": { en: "Language", zh: "界面语言" },
  "set.languageDesc": { en: "UI language of this plugin.", zh: "插件界面语言。" },
  "set.langAuto": { en: "Auto (follow Obsidian)", zh: "自动（跟随 Obsidian）" },
  "set.userName": { en: "Your name", zh: "你的名字" },
  "set.userNameDesc": { en: "Optional. Personalizes the greeting in an empty chat.", zh: "可选。用于空白对话中的问候语。" },
  "set.agent": { en: "Agent behaviour", zh: "助手行为" },
  "set.perm": { en: "What WorkBuddy may do", zh: "WorkBuddy 的权限" },
  "set.permDesc": { en: "Applies to every new message. Also switchable from the chip in the chat footer.", zh: "对每条新消息生效。也可以通过对话框底部的标签切换。" },
  "set.model": { en: "Model", zh: "模型" },
  "set.modelDesc": { en: "Model id passed to WorkBuddy (e.g. glm-5.1). Leave empty for WorkBuddy's default (auto).", zh: "传给 WorkBuddy 的模型 ID（如 glm-5.1）。留空使用 WorkBuddy 默认（auto）。" },
  "set.effort": { en: "Reasoning effort", zh: "思考深度" },
  "set.effortDesc": { en: "How hard the model thinks before answering. Default lets WorkBuddy decide.", zh: "模型回答前的思考程度。默认由 WorkBuddy 决定。" },
  "set.maxTurns": { en: "Max agent turns per message", zh: "每条消息最多执行轮数" },
  "set.maxTurnsDesc": { en: "Safety cap on how many tool steps one message may take. 0 = no limit.", zh: "一条消息最多执行多少步工具操作。0 表示不限制。" },
  "set.workingFolder": { en: "Working folder", zh: "工作目录" },
  "set.workingFolderDesc": { en: "Folder WorkBuddy operates in, relative to the vault root. Empty = whole vault. An absolute path is also accepted.", zh: "WorkBuddy 的工作目录（相对于库根目录）。留空 = 整个库。也可填写绝对路径。" },
  "set.includeNoteContent": { en: "Send full note text with 'current note'", zh: "勾选“当前笔记”时发送全文" },
  "set.includeNoteContentDesc": { en: "When on, the note's full text is attached; when off, only its path (WorkBuddy can still read it from disk).", zh: "开启时附带笔记全文；关闭时只发送路径（WorkBuddy 仍可从磁盘读取）。" },
  "set.maxTabs": { en: "Max chat tabs", zh: "最多对话标签数" },
  "set.maxTabsDesc": { en: "Maximum number of parallel chat tabs (1-10).", zh: "同时打开的对话标签数量（1-10）。" },
  "set.idleTimeout": { en: "Idle timeout (seconds)", zh: "无响应超时（秒）" },
  "set.idleTimeoutDesc": { en: "Stop a turn if WorkBuddy produces no output for this long. Default 600.", zh: "WorkBuddy 多久没有任何输出就停止本轮。默认 600。" },
  "set.prompt": { en: "Instructions", zh: "指令" },
  "set.mdReminder": { en: "Markdown formatting reminder", zh: "Markdown 格式提醒" },
  "set.mdReminderDesc": { en: "Remind WorkBuddy that replies render as Markdown in a narrow sidebar (fenced code, real tables, small headings).", zh: "提醒 WorkBuddy 回复会以 Markdown 形式显示在侧边栏（代码块、表格、小标题）。" },
  "set.customPrompt": { en: "Custom instructions", zh: "自定义指令" },
  "set.customPromptDesc": { en: "Appended to WorkBuddy's system prompt for every message from this vault (tone, style, rules).", zh: "附加到每条消息的系统提示中（语气、风格、规则）。" },
  "set.showThinking": { en: "Show thinking", zh: "显示思考过程" },
  "set.showThinkingDesc": { en: "Show the model's (collapsed) reasoning trace above each reply.", zh: "在每条回复上方显示（折叠的）思考过程。" },
  "set.docs": { en: "WorkBuddy help", zh: "WorkBuddy 帮助" },
  "set.docsDesc": { en: "Official WorkBuddy documentation (install, sign in, models).", zh: "WorkBuddy 官方文档（安装、登录、模型）。" },
  "set.open": { en: "Open", zh: "打开" },

  // ---- commands ----
  "cmd.open": { en: "Open chat view", zh: "打开 WorkBuddy 对话" },
  "cmd.newTab": { en: "New chat tab", zh: "新建对话标签" },
  "cmd.sendNote": { en: "Send current note to WorkBuddy", zh: "把当前笔记发给 WorkBuddy" },
  "cmd.sendSelection": { en: "Send selection to WorkBuddy", zh: "把选中文本发给 WorkBuddy" },
  "cmd.ribbon": { en: "Open WorkBuddy", zh: "打开 WorkBuddy" }
};

/**
 * Decide the UI language. `setting` wins when explicit; "auto" follows the
 * host locale (Obsidian stores it in localStorage "language", e.g. "zh",
 * "zh-TW", "en"; null means English).
 */
export function resolveLang(setting: LangSetting | undefined, hostLocale: string | null | undefined): Lang {
  if (setting === "en" || setting === "zh") return setting;
  const loc = (hostLocale || "").toLowerCase();
  return loc.startsWith("zh") ? "zh" : "en";
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Build a `t()` bound to a language. Missing keys return the key itself. */
export function makeT(lang: Lang): Translate {
  return (key, vars) => {
    const entry = STRINGS[key];
    let s = entry ? entry[lang] || entry.en : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.split(`{${k}}`).join(String(v));
      }
    }
    return s;
  };
}

/** All known keys (for tests / completeness checks). */
export function i18nKeys(): string[] {
  return Object.keys(STRINGS);
}
