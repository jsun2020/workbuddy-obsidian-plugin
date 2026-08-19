import test from "node:test";
import assert from "node:assert/strict";
import { resolveLang, makeT, i18nKeys } from "./.build/i18n.mjs";

test("resolveLang: explicit setting wins, auto follows host locale, default en", () => {
  assert.equal(resolveLang("zh", "en"), "zh");
  assert.equal(resolveLang("en", "zh"), "en");
  assert.equal(resolveLang("auto", "zh"), "zh");
  assert.equal(resolveLang("auto", "zh-TW"), "zh");
  assert.equal(resolveLang("auto", null), "en");
  assert.equal(resolveLang(undefined, undefined), "en");
});

test("t(): substitution, zh/en, unknown key falls back to the key", () => {
  const en = makeT("en");
  const zh = makeT("zh");
  assert.equal(en("view.tab", { n: 2 }), "Chat 2");
  assert.equal(zh("view.tab", { n: 2 }), "对话 2");
  assert.equal(en("nope.key"), "nope.key");
  assert.equal(zh("set.checkOk", { version: "1", cli: "c", node: "n" }).includes("CLI：c"), true);
});

test("every key has non-empty en and zh", () => {
  const en = makeT("en");
  const zh = makeT("zh");
  for (const k of i18nKeys()) {
    assert.ok(en(k).length > 0, k);
    assert.ok(zh(k).length > 0, k);
    assert.notEqual(en(k), k, `missing en for ${k}`);
  }
});
