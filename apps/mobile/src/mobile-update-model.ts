export const RELEASE_REPOSITORY = "wangyingxuan383-ai/grok-build-desktop";
export const RELEASE_PAGE = `https://github.com/${RELEASE_REPOSITORY}/releases/latest`;
export interface MobileRelease { version: string; name: string; downloadUrl: string; size: number; sha256: string }

export function parseMobileRelease(value: unknown): MobileRelease {
  const release = value as { draft?: boolean; prerelease?: boolean; body?: string; assets?: Array<{ name?: string; browser_download_url?: string; digest?: string; size?: number }> };
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) throw Error("公开发布暂不可用，请稍后重试");
  const rows: MobileRelease[] = [];
  for (const asset of release.assets) {
    const version = /^Grok-Remote-v(\d+\.\d+\.\d+)\.apk$/.exec(asset.name || "")?.[1];
    if (!version || !asset.browser_download_url) continue;
    let url: URL; try { url = new URL(asset.browser_download_url); } catch { continue; }
    if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith(`/${RELEASE_REPOSITORY}/releases/download/`) || decodeURIComponent(url.pathname.split("/").at(-1) || "") !== asset.name) continue;
    let sha256 = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || "")?.[1];
    if (!sha256) for (const line of String(release.body || "").split(/\r?\n/)) {
      if (line.includes(asset.name!)) sha256 = /\b([0-9a-f]{64})\b/i.exec(line)?.[1];
    }
    if (!sha256 || !Number.isSafeInteger(asset.size) || asset.size! <= 0 || asset.size! > 300 * 1024 * 1024) continue;
    rows.push({ version, name: asset.name!, downloadUrl: url.href, size: asset.size!, sha256: sha256.toLowerCase() });
  }
  rows.sort((a, b) => {
    const left = a.version.split(".").map(Number), right = b.version.split(".").map(Number);
    return right[0]! - left[0]! || right[1]! - left[1]! || right[2]! - left[2]!;
  });
  if (!rows.length) throw Error("公开发布尚未提供可校验的手机 APK，可打开发布页查看");
  return rows[0]!;
}
