import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("package and release paths enforce the current chunk and v0.7 UI gates", async () => {
  const [packaging, releaseAssets] = await Promise.all([
    load("./package-win.ps1"),
    load("./generate-release-assets.ps1"),
  ]);
  for (const [name, source] of [["package-win.ps1", packaging], ["generate-release-assets.ps1", releaseAssets]]) {
    assert.match(source, /check-renderer-chunks|npm run check:chunks/, `${name} must run the chunk gate`);
    assert.match(source, /probe-v070-ui\.ps1/, `${name} must run the current UI probe`);
  }
  assert.ok(packaging.indexOf("npm run check:chunks") < packaging.indexOf("electron-builder"), "packaging must reject chunks before electron-builder");
  assert.ok(releaseAssets.indexOf("probe-v070-ui.ps1") < releaseAssets.indexOf("npm sbom"), "release metadata must wait for the current UI gate");
});

test("the v0.7 probe cannot inherit the legacy dynamic version override", async () => {
  const source = await load("./smoke-app.ps1");
  assert.match(source, /if \(\$ProbeScript -eq 'probe-v070-ui\.mjs'\) \{ Remove-Item Env:GROK_EXPECTED_APP_VERSION/);
  assert.match(source, /if \(\$ProbeScript -eq 'probe-v070-ui\.mjs'\) \{[\s\S]*?GROK_DESKTOP_UI_RESPONDER'\] = '1'[\s\S]*?\}/);
  assert.equal(source.match(/GROK_DESKTOP_UI_RESPONDER/g)?.length, 1, "the controllable responder must be scoped to the v0.7 fixture only");
  assert.match(source, /PreviousExpectedAppVersion/);
});

test("offline verify runs current Renderer gates even when compilation is skipped", async () => {
  const source = await load("./verify.ps1");
  const buildBlockEnd = source.indexOf("npm audit");
  assert.ok(source.indexOf("npm run check:chunks") > source.indexOf("if (-not $SkipBuild)"));
  assert.ok(source.indexOf("npm run check:chunks") < buildBlockEnd);
  assert.ok(source.indexOf("probe-v070-ui.ps1") < buildBlockEnd);
});

test("live verify records explicit Plan, Provider, CLI, and multi-session outcomes", async () => {
  const source = await load("./verify-live.ps1");
  for (const gate of ["CLI ACP", "Plan 生命周期", "Provider 回环传输", "当前 Provider 推理", "双会话并行启动", "双会话并行回合与队列/插话"]) {
    assert.ok(source.includes(gate), `missing live result gate: ${gate}`);
  }
  assert.match(source, /Grok CLI was not found; live acceptance cannot pass/);
  assert.match(source, /不得标记为完整 live 通过/);
  assert.match(source, /Add-LiveGateResult\s+'当前 Provider 推理'\s+'skipped'/);
  assert.match(source, /Add-LiveGateResult\s+'双会话并行回合与队列\/插话'\s+'skipped'/);
});
