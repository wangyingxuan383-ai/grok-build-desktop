import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTrustedRemoteMediaArtifact,
  isPublicInternetAddress,
  normalizeAcpMediaArtifactSource,
  resolveTrustedMediaArtifactSource,
  sessionCacheKey,
  sweepSessionMediaCache,
  type PinnedRemoteMediaFetcher,
  type RemoteMediaDnsResolver,
} from "./media-cache-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grok-media-cache-"));
  roots.push(root);
  return root;
}

describe("sweepSessionMediaCache", () => {
  it("binds relative ACP artifacts to the session cwd and decodes file URLs", () => {
    const cwd = process.platform === "win32" ? "C:\\workspace" : "/workspace";
    expect(normalizeAcpMediaArtifactSource("images/result.png", cwd)).toBe(resolve(cwd, "images/result.png"));
    const filePath = process.platform === "win32" ? "C:\\workspace\\猫 图.png" : "/workspace/猫 图.png";
    expect(normalizeAcpMediaArtifactSource(pathToFileURL(filePath).toString(), cwd)).toBe(filePath);
    expect(() => normalizeAcpMediaArtifactSource("https://provider.test/result.png", cwd)).toThrow(/未配置允许/);
    expect(normalizeAcpMediaArtifactSource(
      "https://provider.test/result.png",
      cwd,
      { allowedOrigins: ["https://provider.test/v1"] },
    )).toBe("https://provider.test/result.png");
    expect(() => normalizeAcpMediaArtifactSource(
      "https://cdn.provider.test/result.png",
      cwd,
      { allowedOrigins: ["https://provider.test"] },
    )).toThrow(/不在允许列表/);
    expect(() => normalizeAcpMediaArtifactSource("data:image/png;base64,AAAA", cwd)).toThrow(/URI 协议/);
  });
  it("removes only orphan session directories", async () => {
    const root = await tempRoot();
    const kept = join(root, sessionCacheKey("kept"));
    const orphan = join(root, sessionCacheKey("orphan"));
    await mkdir(kept, { recursive: true });
    await mkdir(orphan, { recursive: true });
    await writeFile(join(kept, "image.png"), "kept");
    await writeFile(join(orphan, "image.png"), "orphan");

    const result = await sweepSessionMediaCache(root, new Set(["kept"]));
    expect(result.removedOrphanDirectories).toBe(1);
    expect(await readFile(join(kept, "image.png"), "utf8")).toBe("kept");
    await expect(readFile(join(orphan, "image.png"), "utf8")).rejects.toThrow();
  });

  it("evicts the oldest files when the global bound is exceeded", async () => {
    const root = await tempRoot();
    const directory = join(root, sessionCacheKey("session"));
    await mkdir(directory, { recursive: true });
    const first = join(directory, "first.png");
    const second = join(directory, "second.png");
    await writeFile(first, "123456");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await writeFile(second, "abcdef");

    const result = await sweepSessionMediaCache(root, new Set(["session"]), 6);
    expect(result).toMatchObject({ removedFiles: 1, bytesBefore: 12, bytesAfter: 6 });
    await expect(readFile(first, "utf8")).rejects.toThrow();
    expect(await readFile(second, "utf8")).toBe("abcdef");
  });

  it("accepts an artifact from the exact transient CLI session and rejects siblings", async () => {
    const root = await tempRoot();
    const transient = join(root, "sessions", "transient-id");
    const sibling = join(root, "sessions", "another-id");
    await mkdir(join(transient, "images"), { recursive: true });
    await mkdir(join(sibling, "images"), { recursive: true });
    const accepted = join(transient, "images", "1.png");
    const rejected = join(sibling, "images", "2.png");
    await writeFile(accepted, "accepted");
    await writeFile(rejected, "rejected");

    expect(await resolveTrustedMediaArtifactSource(accepted, [transient])).toBe(await realpath(accepted));
    expect(await resolveTrustedMediaArtifactSource(rejected, [transient])).toBeUndefined();
  });
});

describe("remote media URL policy", () => {
  const publicDns: RemoteMediaDnsResolver = vi.fn(async (): Promise<readonly [{ address: string; family: 4 }, { address: string; family: 6 }]> => [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);

  it("accepts only public Internet addresses", () => {
    expect(isPublicInternetAddress("93.184.216.34")).toBe(true);
    expect(isPublicInternetAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    for (const address of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
      "172.16.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "::1", "fe80::1", "fd00::1",
      "2001:db8::1", "2002:7f00:1::", "3fff::1",
    ]) expect(isPublicInternetAddress(address)).toBe(false);
  });

  it("pins every validated public DNS answer into the request", async () => {
    const fetcher: PinnedRemoteMediaFetcher = vi.fn(async ({ url, addresses }) => {
      expect(url.href).toBe("https://media.example.com/assets/cat.png");
      expect(addresses).toEqual([
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ]);
      return new Response("png", { status: 200, headers: { "content-type": "image/png" } });
    });
    const response = await fetchTrustedRemoteMediaArtifact("https://media.example.com/assets/cat.png", {
      allowedOrigins: ["https://media.example.com/v1"],
      resolver: publicDns,
      fetcher,
    });
    expect(await response.text()).toBe("png");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("denies remote requests by default and rejects private literals before fetch", async () => {
    const fetcher = vi.fn(async () => new Response("unexpected"));
    await expect(fetchTrustedRemoteMediaArtifact("https://media.example.com/cat.png", {
      resolver: publicDns,
      fetcher,
    })).rejects.toThrow(/未配置允许/);
    await expect(fetchTrustedRemoteMediaArtifact("http://127.0.0.1/admin", {
      allowedOrigins: ["http://127.0.0.1"],
      resolver: publicDns,
      fetcher,
    })).rejects.toThrow(/非公网/);
    await expect(fetchTrustedRemoteMediaArtifact("http://169.254.169.254/latest/meta-data", {
      allowedOrigins: ["http://169.254.169.254"],
      resolver: publicDns,
      fetcher,
    })).rejects.toThrow(/非公网/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects private or mixed DNS answers without making a request", async () => {
    const fetcher = vi.fn(async () => new Response("unexpected"));
    const privateDns: RemoteMediaDnsResolver = vi.fn(async () => [{ address: "192.168.1.9", family: 4 as const }]);
    const mixedDns: RemoteMediaDnsResolver = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ] as const);
    for (const resolver of [privateDns, mixedDns]) {
      await expect(fetchTrustedRemoteMediaArtifact("https://media.example.com/cat.png", {
        allowedOrigins: ["https://media.example.com"], resolver, fetcher,
      })).rejects.toThrow(/非公网/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects cross-origin redirects even when both origins were allowed", async () => {
    const fetcher: PinnedRemoteMediaFetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://cdn.example.com/cat.png" },
    }));
    await expect(fetchTrustedRemoteMediaArtifact("https://media.example.com/start", {
      allowedOrigins: ["https://media.example.com", "https://cdn.example.com"],
      resolver: publicDns,
      fetcher,
    })).rejects.toThrow(/跨源重定向/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("revalidates a same-origin redirect and blocks DNS rebinding", async () => {
    const resolver = vi.fn<RemoteMediaDnsResolver>()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const fetcher: PinnedRemoteMediaFetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "/private" },
    }));
    await expect(fetchTrustedRemoteMediaArtifact("https://media.example.com/start", {
      allowedOrigins: ["https://media.example.com"],
      resolver,
      fetcher,
    })).rejects.toThrow(/非公网/);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects non-HTTP protocols, embedded credentials and invalid redirects", async () => {
    await expect(fetchTrustedRemoteMediaArtifact("file:///etc/passwd", {
      allowedOrigins: ["https://media.example.com"], resolver: publicDns,
    })).rejects.toThrow(/HTTP 或 HTTPS/);
    await expect(fetchTrustedRemoteMediaArtifact("https://user:secret@example.invalid/cat.png", {
      allowedOrigins: ["https://example.invalid"], resolver: publicDns,
    })).rejects.toThrow(/不能包含凭据/);
    const fetcher: PinnedRemoteMediaFetcher = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(fetchTrustedRemoteMediaArtifact("https://media.example.com/start", {
      allowedOrigins: ["https://media.example.com"], resolver: publicDns, fetcher,
    })).rejects.toThrow(/无目标重定向/);
  });
});
