import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppInstallerAsset, AppUpdateDownloadState } from "../../shared/types";

/** Hosts GitHub uses for release downloads (the github.com URL redirects to one of these). */
const DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;

export type DownloadFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; url: string; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }>;

/** The NSIS installer leaves its uninstaller next to the executable; ZIP/portable copies have none. */
export function isInstalledCopy(executable = process.execPath): boolean {
  return existsSync(join(dirname(executable), "Uninstall Grok Build Desktop.exe"));
}

export function installerAssetFrom(
  assets: Array<{ name?: string; browser_download_url?: string; size?: number; digest?: string | null }> | undefined,
  version: string, repository: string, checksums?: Map<string, string>,
): AppInstallerAsset | undefined {
  const expected = `Grok-Build-Desktop-Setup-v${version}-x64.exe`.toLowerCase();
  const asset = assets?.find((row) => (row.name || "").toLowerCase() === expected);
  if (!asset?.browser_download_url || !asset.name) return undefined;
  let url: URL; try { url = new URL(asset.browser_download_url); } catch { return undefined; }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.toLowerCase().startsWith(`/${repository.toLowerCase()}/releases/download/`)) return undefined;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || "")?.[1] ?? checksums?.get(asset.name.toLowerCase());
  return { name: asset.name, downloadUrl: url.href, ...(asset.size ? { size: asset.size } : {}), ...(digest ? { sha256: digest.toLowerCase() } : {}) };
}

/**
 * Downloads the official Setup asset into the app's own update folder, verifies size and
 * SHA-256 (from the release metadata), then hands over to the interactive NSIS installer.
 * Nothing is downloaded or installed without an explicit user action.
 */
export class AppInstallerService {
  private state: AppUpdateDownloadState = { phase: "idle", received: 0 };
  private abort?: AbortController;
  private pending?: Promise<AppUpdateDownloadState>;
  constructor(private readonly directory: string, private readonly fetchDownload: DownloadFetch, private readonly emit: (state: AppUpdateDownloadState) => void) {}

  current(): AppUpdateDownloadState { return { ...this.state, installable: isInstalledCopy() }; }

  private update(patch: Partial<AppUpdateDownloadState>, force = false) {
    const previous = this.state.received;
    this.state = { ...this.state, ...patch };
    // Progress is throttled to ~1% steps; phase changes always go out.
    if (force || !this.state.total || Math.floor((this.state.received / this.state.total) * 100) !== Math.floor((previous / this.state.total) * 100)) this.emit(this.current());
  }

  cancel() { this.abort?.abort(new Error("已取消下载")); }

  download(asset: AppInstallerAsset, version: string): Promise<AppUpdateDownloadState> {
    if (this.pending) return this.pending;
    this.pending = this.downloadOnce(asset, version).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async downloadOnce(asset: AppInstallerAsset, version: string): Promise<AppUpdateDownloadState> {
    if (this.state.phase === "ready" && this.state.version === version && this.state.path && existsSync(this.state.path)) return this.current();
    const target = join(this.directory, basename(asset.name)), partial = `${target}.partial`;
    this.abort = new AbortController();
    this.update({ phase: "downloading", version, name: asset.name, received: 0, total: asset.size, error: undefined, path: undefined, verified: undefined }, true);
    const timeout = setTimeout(() => this.abort?.abort(new Error("更新下载超时，请重试")), 15 * 60_000);
    timeout.unref?.();
    try {
      const initial = new URL(asset.downloadUrl);
      if (initial.protocol !== "https:" || initial.host !== "github.com" || initial.username || initial.password || !/^\/[^/]+\/[^/]+\/releases\/download\//.test(initial.pathname)) throw new Error("安装包下载地址无效");
      await mkdir(this.directory, { recursive: true });
      for (const name of await readdir(this.directory)) if (name !== asset.name && /^Grok-Build-Desktop-Setup-v[\d.]+-x64\.exe(?:\.partial)?$/.test(name)) await rm(join(this.directory, name), { force: true });
      const response = await this.fetchDownload(asset.downloadUrl, { signal: this.abort.signal });
      const destination = new URL(response.url || asset.downloadUrl);
      if (destination.protocol !== "https:" || destination.username || destination.password || destination.port || !DOWNLOAD_HOSTS.has(destination.hostname)) throw new Error(`下载被重定向到未受信任的地址：${destination.hostname}`);
      if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") || 0) || asset.size;
      if (declared && declared > MAX_INSTALLER_BYTES) throw new Error("安装包大小异常，已停止下载");
      this.update({ total: declared }, true);
      const hash = createHash("sha256");
      let received = 0;
      const meter = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.byteLength;
        if (received > MAX_INSTALLER_BYTES) return callback(new Error("安装包大小异常，已停止下载"));
        hash.update(chunk); this.update({ received }); callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(partial), { signal: this.abort.signal });
      if (asset.size && received !== asset.size) throw new Error(`安装包大小不一致（期望 ${asset.size}，实际 ${received}）`);
      const digest = hash.digest("hex");
      if (asset.sha256 && digest !== asset.sha256) throw new Error("安装包 SHA-256 与发布信息不一致，已删除下载文件");
      await rename(partial, target);
      this.update({ phase: "ready", received, path: target, sha256: digest, verified: Boolean(asset.sha256) }, true);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      this.update({ phase: "error", error: error instanceof Error ? error.message : String(error) }, true);
    } finally { clearTimeout(timeout); this.abort = undefined; }
    return this.current();
  }

  /** Starts the interactive installer; the caller quits the app so files can be replaced. */
  async install(): Promise<void> {
    const path = this.state.path;
    if (this.state.phase !== "ready" || !path) throw new Error("安装包尚未下载完成");
    if (!isInstalledCopy()) throw new Error("当前是便携版，请从发布页下载便携版 ZIP 替换");
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile() || (this.state.received && info.size !== this.state.received)) throw new Error("安装包已被移动或修改，请重新下载");
    // Re-hash right before launch so a file swapped after download is never executed.
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve()).on("error", reject));
    if (hash.digest("hex") !== this.state.sha256) { this.update({ phase: "error", error: "安装包在下载后被修改，请重新下载" }, true); throw new Error("安装包在下载后被修改，请重新下载"); }
    const child = spawn(path, [], { detached: true, stdio: "ignore", windowsHide: false });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
  }
}
