import { net } from "electron";
import type { AppReleaseStatus, BuildInfo } from "../../shared/types";
import type { LogService } from "./log-service";
import { parseVersion } from "./cli-locator";

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export class AppReleaseService {
  private cached?: AppReleaseStatus;
  constructor(
    private readonly build: BuildInfo,
    private readonly log: LogService,
    private readonly fetchRelease: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> = (url) => net.fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": `Grok-Build-Desktop/${build.version}` } }),
  ) {}

  async check(force = false): Promise<AppReleaseStatus> {
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < 6 * 60 * 60_000) return this.cached;
    const checkedAt = new Date().toISOString();
    if (!this.build.repository) return this.cached = { configured: false, currentVersion: this.build.version, updateAvailable: false, checkedAt, error: "本地构建，未配置公开更新源" };
    const url = `https://api.github.com/repos/${this.build.repository}/releases/latest`;
    try {
      const response = await this.fetchRelease(url);
      if (!response.ok) throw new Error(`GitHub Release API 返回 HTTP ${response.status}`);
      const status = parseGitHubRelease(await response.json(), this.build, checkedAt);
      this.cached = status;
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.log.log(`Application update check failed: ${message}`);
      return this.cached = { ...(this.cached ?? { configured: true, currentVersion: this.build.version, updateAvailable: false, checkedAt }), checkedAt, error: message };
    }
  }

  releaseUrl(candidate?: string): string {
    const url = candidate || this.cached?.releaseUrl || (this.build.repository ? `https://github.com/${this.build.repository}/releases` : "");
    if (!url) throw new Error("未配置公开更新源");
    const parsed = new URL(url);
    const prefix = this.build.repository ? `/${this.build.repository.toLowerCase()}/releases` : "";
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || !parsed.pathname.toLowerCase().startsWith(prefix)) throw new Error("拒绝打开非配置仓库的更新链接");
    return parsed.href;
  }
}

export function parseGitHubRelease(value: unknown, build: BuildInfo, checkedAt = new Date().toISOString()): AppReleaseStatus {
  const release = value as GitHubRelease;
  if (!release || release.draft || release.prerelease || !release.tag_name || !release.html_url) throw new Error("GitHub Release 响应无有效稳定版本");
  const latestVersion = release.tag_name.replace(/^v/i, "");
  return {
    configured: true,
    currentVersion: build.version,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, build.version) > 0,
    checkedAt,
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    notes: String(release.body || "").slice(0, 20_000),
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left) ?? [0, 0, 0];
  const b = parseVersion(right) ?? [0, 0, 0];
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  return 0;
}
