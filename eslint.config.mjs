import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: ["main.js", "tests/.build/**", "node_modules/**", "esbuild.config.mjs", "eslint.config.mjs"]
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // "WorkBuddy" is a product name that must keep its capitalisation; the
      // official reviewer does not gate on this rule.
      "obsidianmd/ui/sentence-case": "off"
    }
  }
);
