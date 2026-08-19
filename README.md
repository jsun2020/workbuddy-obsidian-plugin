# WorkBuddy - Obsidian plugin

Chat with your locally installed **WorkBuddy** (Tencent's desktop AI agent) from inside Obsidian.
Send the current note or a selection as context, stream the reply into a sidebar, and let WorkBuddy
read, search, create and edit notes in your vault.

> Unofficial community plugin. Not affiliated with Tencent. Requires the WorkBuddy desktop app to be
> installed and signed in. Desktop only (Windows verified; macOS/Linux best-effort).

**Zero configuration**: no API key, no server, no port. The plugin runs the command-line tool that ships
inside the WorkBuddy app, using WorkBuddy's own login. The WorkBuddy window does not even need to be open.

---

## 快速上手（中文）

1. 安装并打开一次 **WorkBuddy**，完成登录（之后可以关掉它）。
2. 在 Obsidian 中安装本插件并启用（见下方「安装」）。
3. 点击左侧栏的机器人图标，或按 `Ctrl/Cmd+P` 运行「打开 WorkBuddy 对话」。
4. 直接输入问题；勾选「当前笔记」或「选中文本」可以把笔记内容一起发给 WorkBuddy。
5. 回复下方有「复制」和「插入到光标处」按钮。

默认权限是「允许修改笔记」：WorkBuddy 可以读取、新建、修改库里的笔记，但不能运行命令。
在对话框底部点击权限标签，或在设置里切换为「只读」/「完全访问」。

如果提示「没有找到 WorkBuddy」：打开 设置 -> WorkBuddy -> 点击「检测 WorkBuddy」查看插件尝试过的路径；
安装位置特殊时，可以在「CLI 路径」里填写
`...\WorkBuddy\resources\app.asar.unpacked\cli\bin\codebuddy` 的完整路径。

---

## Features

- Sidebar chat with streaming Markdown replies, collapsible "thinking", tool activity lines
  (`Read notes/todo.md`, `Write ...`), token usage.
- Multi-tab conversations; Send turns into Stop while a reply streams.
- Context toggles: **current note** (path + full text) and **selection** (works in Reading View too).
- Commands + ribbon icon: open chat, new tab, send current note, send selection.
- **Copy** and **Insert at cursor** under every reply.
- Chat history (persisted in the plugin folder). Reopening a conversation resumes WorkBuddy's own
  session, so context continues server-side.
- Permission modes: **Read only** / **Allow editing notes** (default) / **Full access**.
- Model and reasoning-effort chips in the footer; working folder (vault root by default).
- Chinese + English UI, auto-selected from Obsidian's language.

## How it works

WorkBuddy bundles a Claude-Code-compatible CLI (`<WorkBuddy>/resources/app.asar.unpacked/cli/bin/codebuddy`).
For every message the plugin spawns it non-interactively:

```
node codebuddy -p --input-format stream-json --output-format stream-json --include-partial-messages \
     --permission-mode acceptEdits [--resume <session_id>] [--model ...] [--append-system-prompt ...]
```

with the vault as the working directory, feeds one user message over stdin, and renders the NDJSON
event stream. Continuity between turns comes from `--resume <session_id>`. The Node runtime is found
automatically: WorkBuddy's own bundled Node (`~/.workbuddy/binaries/node/...`), then the WorkBuddy
executable itself (Electron in Node mode), then `node` on PATH.

Nothing is stored by the plugin except your settings and chat history (`history.json` in the plugin
folder). It never reads WorkBuddy's credential or model files.

### Permission modes

| Mode | CLI flags | What WorkBuddy can do |
|---|---|---|
| Read only | `--permission-mode default --disallowedTools Write,Edit,...,Bash,PowerShell` | read/search notes, web |
| Allow editing notes (default) | `--permission-mode acceptEdits` | + create/edit files in the working folder; no shell |
| Full access | `--permission-mode bypassPermissions` | everything, including shell commands - use with care |

The CLI offers no interactive approval channel in non-interactive mode, so the mode is chosen up front.

## Install

### Via BRAT (recommended until the plugin is listed)

1. Install the **BRAT** community plugin and enable it.
2. Run **BRAT: Add a beta plugin for testing** and paste this repository's URL.
3. Enable **WorkBuddy** under Settings -> Community plugins.

### Manual

Download `main.js`, `manifest.json` and `styles.css` from the latest release into
`<vault>/.obsidian/plugins/workbuddy/`, then enable the plugin.

## Settings

- **Check WorkBuddy** - locates the CLI + runtime and runs `--version`; shows the paths it tried on failure.
- **CLI path / Node runtime** (advanced) - overrides for unusual installs.
- **What WorkBuddy may do** - permission mode (see above).
- **Model** (empty = WorkBuddy default `auto`), **Reasoning effort**, **Max agent turns**.
- **Working folder** - vault-relative or absolute; the CLI's cwd.
- **Send full note text with "current note"**, **Show thinking**, **Max chat tabs**, **Idle timeout**.
- **Markdown formatting reminder**, **Custom instructions** (appended to the system prompt).
- **Language** - Auto / 简体中文 / English. **Your name** - personalizes the greeting.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "WorkBuddy was not found on this computer" | Install WorkBuddy; open it once. Check the paths listed under **Check WorkBuddy**; set **CLI path** if installed elsewhere. |
| "Could not find a Node.js runtime" | Open the WorkBuddy app once (it installs its Node), or set **Node runtime** to `WorkBuddy.exe` / any `node.exe`. |
| "WorkBuddy is not signed in" | Open the WorkBuddy app and sign in, then retry. |
| Reply says it cannot write / tool requests denied | Switch the permission chip to **Allow editing notes**. |
| No reply for minutes, then a timeout | The first call after a cold start can take a while; raise **Idle timeout** if your machine is slow. |

## Build

```powershell
npm install
npm run build        # -> main.js
npm test             # unit tests (pure modules)
npm run lint         # Obsidian community lint rules
npm run smoke:live   # drives the REAL WorkBuddy CLI through the plugin's client (needs WorkBuddy + network)
```

### Releasing (maintainers)

Bump the version in `manifest.json`, `package.json` and `versions.json`, then push a matching tag
(bare version, no `v`): `git tag 0.1.1 && git push origin 0.1.1`. The GitHub Action builds, verifies the
tag matches the manifest, attaches provenance attestations and creates the release with
`main.js` / `manifest.json` / `styles.css`.

## License

MIT
