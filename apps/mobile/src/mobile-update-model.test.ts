import test from "node:test";
import assert from "node:assert/strict";
import { parseMobileRelease, RELEASE_REPOSITORY } from "./mobile-update-model.ts";
const asset = (version = "0.3.6") => ({ name: `Grok-Remote-v${version}.apk`, browser_download_url: `https://github.com/${RELEASE_REPOSITORY}/releases/download/v0.11.5/Grok-Remote-v${version}.apk`, size: 9000, digest: `sha256:${"a".repeat(64)}` });
test("chooses the latest stable APK with size and hash for independent phone updates", () => {
  assert.equal(parseMobileRelease({ assets: [asset("0.3.5"), asset(), asset("0.2.9")] }).version, "0.3.6");
  assert.equal(parseMobileRelease({ assets: [asset()] }).sha256, "a".repeat(64));
});
test("rejects other repositories, forged names, unsigned metadata and oversized APKs", () => {
  for (const change of [
    { browser_download_url: "https://github.com/other/repo/releases/download/v1/Grok-Remote-v0.3.6.apk" },
    { browser_download_url: asset().browser_download_url + "?extra=1" },
    { browser_download_url: asset().browser_download_url.replace("Grok-Remote-v0.3.6.apk", "wrong.apk") },
    { digest: "" }, { size: 400 * 1024 * 1024 }, { size: -1 },
  ]) assert.throws(() => parseMobileRelease({ assets: [{ ...asset(), ...change }] }), /可校验/);
  assert.throws(() => parseMobileRelease({ prerelease: true, assets: [asset()] }), /暂不可用/);
});
test("accepts checksum notes when GitHub digest metadata is unavailable", () => {
  const file = { ...asset(), digest: undefined };
  assert.equal(parseMobileRelease({ assets: [file], body: `${"b".repeat(64)}  ${file.name}` }).sha256, "b".repeat(64));
});
