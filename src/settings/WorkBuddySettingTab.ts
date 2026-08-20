import { App, PluginSettingTab, Setting } from "obsidian";
import type WorkBuddyPlugin from "../main";
import { EFFORT_OPTIONS, type PermissionMode, type ReasoningEffort } from "./types";
import type { LangSetting } from "../runtime/i18n";

const DOCS_URL = "https://www.codebuddy.cn/docs/workbuddy/Overview";

export class WorkBuddySettingTab extends PluginSettingTab {
  private plugin: WorkBuddyPlugin;

  constructor(app: App, plugin: WorkBuddyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    const t = (k: string, v?: Record<string, string | number>) => this.plugin.t(k, v);
    containerEl.empty();

    // ---- installation ----
    new Setting(containerEl).setName(t("set.install")).setDesc(t("set.installDesc")).setHeading();

    const checkSetting = new Setting(containerEl).setName(t("set.check")).setDesc(t("set.checkDesc"));
    const resultEl = containerEl.createDiv({ cls: "workbuddy-test-result" });
    checkSetting.addButton((btn) =>
      btn.setButtonText(t("set.check")).onClick(async () => {
        resultEl.empty();
        resultEl.removeClass("workbuddy-test-ok", "workbuddy-test-fail");
        resultEl.setText(t("set.checking"));
        const r = await this.plugin.client.checkInstall();
        resultEl.empty();
        if (r.ok) {
          resultEl.addClass("workbuddy-test-ok");
          const kind = r.runtimeKind === "electron" ? "WorkBuddy (Electron as Node)" : r.runtimeKind;
          resultEl.setText(t("set.checkOk", { version: r.version, cli: r.cliPath ?? "-", node: `${r.nodePath ?? "-"} [${kind}]` }));
        } else {
          resultEl.addClass("workbuddy-test-fail");
          resultEl.setText(t("set.checkFail", { err: r.error }));
          const tried = [...r.resolution.triedCli.slice(0, 4), ...r.resolution.triedNode.slice(0, 4)];
          if (tried.length) {
            const ul = resultEl.createEl("ul", { cls: "workbuddy-test-tried" });
            for (const p of tried) ul.createEl("li", { text: p });
          }
        }
      })
    );

    new Setting(containerEl)
      .setName(t("set.cliPath"))
      .setDesc(t("set.cliPathDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("set.auto"))
          .setValue(this.plugin.settings.cliPath)
          .onChange(async (v) => {
            this.plugin.settings.cliPath = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("set.nodePath"))
      .setDesc(t("set.nodePathDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("set.auto"))
          .setValue(this.plugin.settings.nodePath)
          .onChange(async (v) => {
            this.plugin.settings.nodePath = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("set.docs"))
      .setDesc(t("set.docsDesc"))
      .addButton((btn) => btn.setButtonText(t("set.open")).onClick(() => window.open(DOCS_URL)));

    // ---- agent behaviour ----
    new Setting(containerEl).setName(t("set.agent")).setHeading();

    new Setting(containerEl)
      .setName(t("set.perm"))
      .setDesc(`${t("set.permDesc")}\n${t("perm.readonly")}: ${t("perm.readonly.desc")}\n${t("perm.edits")}: ${t("perm.edits.desc")}\n${t("perm.full")}: ${t("perm.full.desc")}`)
      .addDropdown((dd) =>
        dd
          .addOption("readonly", t("perm.readonly"))
          .addOption("edits", t("perm.edits"))
          .addOption("full", t("perm.full"))
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (v) => {
            this.plugin.settings.permissionMode = v as PermissionMode;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          })
      );

    new Setting(containerEl)
      .setName(t("set.model"))
      .setDesc(t("set.modelDesc"))
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          })
      );

    new Setting(containerEl)
      .setName(t("set.effort"))
      .setDesc(t("set.effortDesc"))
      .addDropdown((dd) => {
        for (const e of EFFORT_OPTIONS) dd.addOption(e, e || t("view.effortDefault"));
        dd.setValue(this.plugin.settings.reasoningEffort).onChange(async (v) => {
          this.plugin.settings.reasoningEffort = v as ReasoningEffort;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        });
      });

    new Setting(containerEl)
      .setName(t("set.maxTurns"))
      .setDesc(t("set.maxTurnsDesc"))
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.maxTurns || 0))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.maxTurns = Number.isFinite(n) && n > 0 ? n : 0;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("set.workingFolder"))
      .setDesc(t("set.workingFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.workingFolder)
          .onChange(async (v) => {
            this.plugin.settings.workingFolder = v.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          })
      );

    new Setting(containerEl)
      .setName(t("set.includeNoteContent"))
      .setDesc(t("set.includeNoteContentDesc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.includeNoteContent).onChange(async (v) => {
          this.plugin.settings.includeNoteContent = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("set.showThinking"))
      .setDesc(t("set.showThinkingDesc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showThinking).onChange(async (v) => {
          this.plugin.settings.showThinking = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("set.maxTabs"))
      .setDesc(t("set.maxTabsDesc"))
      .addSlider((sl) =>
        sl
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.maxTabs)
          .onChange(async (v) => {
            this.plugin.settings.maxTabs = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("set.idleTimeout"))
      .setDesc(t("set.idleTimeoutDesc"))
      .addText((text) =>
        text
          .setPlaceholder("600")
          .setValue(String(this.plugin.settings.idleTimeoutSec || 600))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.idleTimeoutSec = Number.isFinite(n) && n >= 30 ? n : 600;
            await this.plugin.saveSettings();
          })
      );

    // ---- instructions ----
    new Setting(containerEl).setName(t("set.prompt")).setHeading();

    new Setting(containerEl)
      .setName(t("set.mdReminder"))
      .setDesc(t("set.mdReminderDesc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.markdownFormattingPromptEnabled).onChange(async (v) => {
          this.plugin.settings.markdownFormattingPromptEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("set.customPrompt"))
      .setDesc(t("set.customPromptDesc"))
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.customSystemPrompt).onChange(async (v) => {
          this.plugin.settings.customSystemPrompt = v;
          await this.plugin.saveSettings();
        });
        ta.inputEl.rows = 5;
        ta.inputEl.addClass("workbuddy-settings-textarea");
      });

    // ---- appearance ----
    new Setting(containerEl)
      .setName(t("set.language"))
      .setDesc(t("set.languageDesc"))
      .addDropdown((dd) =>
        dd
          .addOption("auto", t("set.langAuto"))
          .addOption("zh", "简体中文")
          .addOption("en", "English")
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            this.plugin.settings.language = v as LangSetting;
            await this.plugin.saveSettings();
            this.plugin.applyLanguageChange();
            // Re-render this tab in the new language.
            this.render();
          })
      );

    new Setting(containerEl)
      .setName(t("set.userName"))
      .setDesc(t("set.userNameDesc"))
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.userName)
          .onChange(async (v) => {
            this.plugin.settings.userName = v.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
