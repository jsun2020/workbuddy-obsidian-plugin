// Build script for the WorkBuddy Obsidian plugin.
// Bundles src/main.ts -> main.js (CommonJS) with esbuild. Node builtins
// (child_process/fs/os/path) stay external because Obsidian runs desktop
// plugins in an Electron renderer with Node integration, so require("fs")
// resolves at runtime.
import esbuild from "esbuild";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2018",
  platform: "node",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: "main.js",
  external: [
    "obsidian",
    "electron",
    "child_process",
    "fs",
    "os",
    "path",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common"
  ]
});

if (production) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
  console.log("[workbuddy] watching for changes...");
}
