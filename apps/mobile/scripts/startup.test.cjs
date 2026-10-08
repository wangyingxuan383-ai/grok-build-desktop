const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const renderer = require("react-test-renderer");
const { mismatches } = require("./check-native-dependencies.cjs");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function load(name, mocks) {
  const path = join(__dirname, "../src", name);
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = new Module(path);
  loaded.paths = Module._nodeModulePaths(join(__dirname, ".."));
  loaded.require = id => id in mocks ? mocks[id] : require(id);
  loaded._compile(compiled, path);
  return loaded.exports;
}

const native = { Platform: { OS: "android" }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", Share: { share: async () => undefined } };

test("SDK guard rejects transitive future assets and constants", () => {
  const matrix = { "expo-asset": "~12.0.13", "expo-constants": "~18.0.14" };
  assert.equal(mismatches([{ name: "expo-asset", version: "57.0.18" }, { name: "expo-constants", version: "57.0.20" }], matrix).length, 2);
  assert.deepEqual(mismatches([{ name: "expo-asset", version: "12.0.13" }], matrix), []);
});

test("application import failures show recovery; explicit retry can load successfully without diagnostics leaking raw errors", async () => {
  let calls = 0;
  let fail = true;
  const shares = [];
  const app = {};
  Object.defineProperty(app, "default", { get() { calls++; if (fail) throw TypeError("fixture-private-token-and-host"); return () => React.createElement("LoadedApp"); } });
  const { StartupRoot } = load("startup.tsx", { "react-native": { ...native, Share: { share: async ({ message }) => shares.push(message) } }, "./version": { MOBILE_VERSION: "0.3.1" }, "../App": app });
  assert.equal(calls, 0);
  const previous = console.error;
  console.error = () => undefined;
  let tree;
  try {
    await renderer.act(() => { tree = renderer.create(React.createElement(StartupRoot)); });
    assert.ok(tree.root.findByProps({ accessibilityLabel: "重试加载" }));
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: "分享启动诊断" }).props.onPress());
    assert.equal(shares.length, 1);
    assert.ok(!shares[0].includes("fixture-private"));
    fail = false;
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: "重试加载" }).props.onPress());
    assert.equal(tree.root.findAllByType("LoadedApp").length, 1);
    assert.equal(tree.root.findAllByProps({ accessibilityLabel: "重试加载" }).length, 0);
  } finally { if (tree) await renderer.act(() => tree.unmount()); console.error = previous; }
});

test("HTML native view lookup is deferred and failure stays in the viewer", async () => {
  let lookups = 0;
  const { NativeHtmlPreview } = load("native-preview.tsx", { "react-native": native, "expo-modules-core": { requireNativeViewManager() { lookups++; throw Error("unavailable"); } } });
  assert.equal(lookups, 0);
  const previous = console.error;
  console.error = () => undefined;
  let tree;
  try {
    await renderer.act(() => { tree = renderer.create(React.createElement(NativeHtmlPreview, { source: { host: "synthetic", token: "synthetic", fingerprint: "synthetic", ticket: "synthetic" } })); });
    assert.equal(lookups, 1);
    assert.ok(JSON.stringify(tree.toJSON()).includes("HTML 预览组件不可用"));
  } finally { if (tree) await renderer.act(() => tree.unmount()); console.error = previous; }
});

test("HTML native view is resolved only when opened and reuses the available view", async () => {
  let lookups = 0;
  const source = { host: "synthetic", token: "synthetic", fingerprint: "synthetic", ticket: "synthetic" };
  const { NativeHtmlPreview } = load("native-preview.tsx", { "react-native": native, "expo-modules-core": { requireNativeViewManager() { lookups++; return "NativePreview"; } } });
  const previous = console.error;
  console.error = () => undefined;
  let tree;
  try {
    await renderer.act(() => { tree = renderer.create(React.createElement(NativeHtmlPreview, { source })); });
    assert.deepEqual(tree.root.findByType("NativePreview").props.source, source);
    await renderer.act(() => tree.unmount());
    await renderer.act(() => { tree = renderer.create(React.createElement(NativeHtmlPreview, { source })); });
    assert.equal(lookups, 1);
  } finally { if (tree) await renderer.act(() => tree.unmount()); console.error = previous; }
});
