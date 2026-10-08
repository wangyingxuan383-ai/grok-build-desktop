import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppInstallerService, installerAssetFrom, type DownloadFetch } from "./app-installer-service";
import { checksumsFromNotes } from "./app-release-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
const repo = "owner/grok-build-desktop";
const payload = Buffer.from("installer-bytes".repeat(1000));
const sha = createHash("sha256").update(payload).digest("hex");
const body = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(payload.subarray(0, 5000)); controller.enqueue(payload.subarray(5000)); controller.close(); } });
const fetchFrom = (url: string, status = 200): DownloadFetch => async () => ({ ok: status === 200, status, url, headers: { get: (name: string) => name === "content-length" ? String(payload.length) : null }, body: body() });

it("accepts only this repository's exact Setup asset and reads its SHA-256 from the digest or notes", () => {
  const download = `https://github.com/${repo}/releases/download/v0.12.0/Grok-Build-Desktop-Setup-v0.12.0-x64.exe`;
  expect(installerAssetFrom([{ name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", browser_download_url: download, size: 9, digest: `sha256:${sha}` }], "0.12.0", repo)).toEqual({ name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", downloadUrl: download, size: 9, sha256: sha });
  expect(installerAssetFrom([{ name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", browser_download_url: "https://github.com/someone/else/releases/download/v0.12.0/x.exe" }], "0.12.0", repo)).toBeUndefined();
  expect(installerAssetFrom([{ name: "Grok-Build-Desktop-Setup-v0.11.0-x64.exe", browser_download_url: download }], "0.12.0", repo)).toBeUndefined();
  const notes = checksumsFromNotes(`| Grok-Build-Desktop-Setup-v0.12.0-x64.exe | \`${sha}\` |\r\nother line`);
  expect(installerAssetFrom([{ name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", browser_download_url: download }], "0.12.0", repo, notes)?.sha256).toBe(sha);
});

it("downloads, verifies the hash and keeps only the newest installer", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-installer-")); roots.push(root);
  const events: string[] = [];
  const service = new AppInstallerService(root, fetchFrom("https://release-assets.githubusercontent.com/x"), (state) => events.push(state.phase));
  const result = await service.download({ name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", downloadUrl: `https://github.com/${repo}/releases/download/v0.12.0/a.exe`, size: payload.length, sha256: sha }, "0.12.0");
  expect(result).toMatchObject({ phase: "ready", verified: true, received: payload.length, sha256: sha });
  expect(await readFile(result.path!)).toEqual(payload);
  expect(events[0]).toBe("downloading"); expect(events.at(-1)).toBe("ready");
  expect(await readdir(root)).toEqual(["Grok-Build-Desktop-Setup-v0.12.0-x64.exe"]);
});

it("rejects a wrong hash, a wrong size and an untrusted redirect without leaving files behind", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-installer-bad-")); roots.push(root);
  const asset = { name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", downloadUrl: `https://github.com/${repo}/releases/download/v0.12.0/a.exe` };
  const wrongHash = await new AppInstallerService(root, fetchFrom("https://github.com/x"), () => undefined).download({ ...asset, sha256: "0".repeat(64) }, "0.12.0");
  expect(wrongHash).toMatchObject({ phase: "error" }); expect(wrongHash.error).toContain("SHA-256");
  const wrongSize = await new AppInstallerService(root, fetchFrom("https://github.com/x"), () => undefined).download({ ...asset, size: 3 }, "0.12.0");
  expect(wrongSize.error).toContain("大小不一致");
  const redirected = await new AppInstallerService(root, fetchFrom("https://evil.example/x"), () => undefined).download(asset, "0.12.0");
  expect(redirected.error).toContain("未受信任");
  expect(await readdir(root)).toEqual([]);
});

it("coalesces double-click downloads before directory setup and waits for verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-installer-concurrent-")); roots.push(root);
  let count = 0;
  const service = new AppInstallerService(root, async (...args) => { count++; return fetchFrom("https://github.com/x")(...args); }, () => undefined);
  const asset = { name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", downloadUrl: `https://github.com/${repo}/releases/download/v0.12.0/a.exe`, size: payload.length, sha256: sha };
  const first = service.download(asset, "0.12.0"), second = service.download(asset, "0.12.0");
  expect(first).toBe(second);
  expect((await first).phase).toBe("ready"); expect(count).toBe(1);
});

it("returns recoverable disk errors and rejects downgraded HTTP redirects", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-installer-disk-")); roots.push(root);
  const blocked = join(root, "file"); await writeFile(blocked, "occupied");
  const asset = { name: "Grok-Build-Desktop-Setup-v0.12.0-x64.exe", downloadUrl: `https://github.com/${repo}/releases/download/v0.12.0/a.exe` };
  expect((await new AppInstallerService(blocked, fetchFrom("https://github.com/x"), () => undefined).download(asset, "0.12.0")).phase).toBe("error");
  expect((await new AppInstallerService(root, fetchFrom("http://github.com/x"), () => undefined).download(asset, "0.12.0")).error).toContain("未受信任");
});
