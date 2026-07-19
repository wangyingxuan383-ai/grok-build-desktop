import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliUpdateService } from "./cli-update-service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createService(root: string): CliUpdateService {
  return new CliUpdateService(
    root,
    vi.fn(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    { log: vi.fn() } as any,
  );
}

describe("CliUpdateService", () => {
  it("coalesces concurrent apply requests into one update operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const service = createService(root);
    let finish!: (value: { found: boolean; currentVersion: string }) => void;
    const operation = new Promise<{ found: boolean; currentVersion: string }>((resolve) => { finish = resolve; });
    const applyOnce = vi.fn(() => operation);
    (service as any).applyOnce = applyOnce;

    const first = service.apply();
    const second = service.apply();
    expect(applyOnce).toHaveBeenCalledTimes(1);
    finish({ found: true, currentVersion: "0.2.101" });
    await expect(first).resolves.toMatchObject({ currentVersion: "0.2.101" });
    await expect(second).resolves.toMatchObject({ currentVersion: "0.2.101" });
  });

  it("redacts secrets before persisting update history", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const service = createService(root);
    await (service as any).record({ at: new Date().toISOString(), status: "failed", message: "token xai-very-secret-key-value" });
    const history = await service.history();
    expect(history[0]?.message).not.toContain("very-secret");
    expect(history[0]?.message).toContain("REDACTED");
  });
});
