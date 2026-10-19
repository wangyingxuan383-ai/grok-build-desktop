import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliConfigState } from "../../shared/cli-config-state";
import { LogService } from "./log-service";
import { ProviderService } from "./provider-service";

const roots: string[] = [];
const services: ProviderService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function catalog(id: string): string {
  return `[models]\ndefault = "${id}"\n[model.${id}]\nmodel = "upstream/${id}"\nbase_url = "http://127.0.0.1:15721/private?token=hidden"\nenv_key = "PRIVATE_KEY"\n`;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "grok-provider-config-"));
  roots.push(root);
  const grokHome = join(root, ".grok");
  await mkdir(grokHome);
  const path = join(grokHome, "config.toml");
  await writeFile(path, catalog("first"));
  const environment = { read: vi.fn(async () => { throw new Error("must not scan credentials"); }), write: vi.fn() };
  const reloadModels = vi.fn();
  const validateConfig = vi.fn();
  const fetcher = vi.fn();
  const service = new ProviderService(join(root, "data"), new LogService(join(root, "logs", "app.log")), {
    grokHome, environment, reloadModels, validateConfig, fetcher,
  });
  services.push(service);
  return { root, grokHome, path, service, environment, reloadModels, validateConfig, fetcher };
}

describe("ProviderService external CLI config coexistence", () => {
  it("reloads read-only catalogs after atomic replacement without launching, writing or scanning", async () => {
    const { root, grokHome, path, service, environment, reloadModels, validateConfig, fetcher } = await fixture();
    const states: CliConfigState[] = [];
    await service.startConfigObserver((state) => states.push(state));
    expect((await service.list()).map((provider) => provider.models[0]?.id)).toEqual(["first"]);
    const replacement = join(grokHome, "replacement.tmp");
    await writeFile(replacement, catalog("second"));
    await rename(replacement, path);
    await vi.waitFor(() => expect(states.at(-1)?.defaultModelId).toBe("second"));
    const providers = await service.list();
    expect(providers).toMatchObject([{ owned: false, hasCredential: false, models: [{ id: "second" }] }]);
    expect(service.getCliConfigState()).toEqual(states.at(-1));
    expect(environment.read).not.toHaveBeenCalled();
    expect(environment.write).not.toHaveBeenCalled();
    expect(reloadModels).not.toHaveBeenCalled();
    expect(validateConfig).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(catalog("second"));
    expect(await readdir(grokHome)).toEqual(["config.toml"]);
    expect(JSON.stringify(states)).not.toMatch(/PRIVATE_KEY|hidden|15721|127\.0\.0\.1|cc-switch/);
    expect(JSON.stringify(states)).not.toContain(root);
  });

  it("keeps the previous catalog during partial writes even without starting observation", async () => {
    const { path, service } = await fixture();
    const previous = await service.list();
    await writeFile(path, '[model.second]\nbase_url = "unfinished');
    expect(await service.list()).toEqual(previous);
    expect(service.getCliConfigState().notice).toBe("config-invalid");
    await writeFile(path, catalog("second"));
    expect((await service.list())[0]?.models[0]?.id).toBe("second");
    expect(service.getCliConfigState().notice).toBeUndefined();
  });

  it("refreshes the catalog before notifying a subscribing parent and stops after disposal", async () => {
    const { path, service } = await fixture();
    const notifiedCatalogs: string[][] = [];
    const refreshes: Promise<void>[] = [];
    await service.startConfigObserver(() => {
      refreshes.push(service.list().then((providers) => { notifiedCatalogs.push(providers.flatMap((provider) => provider.models.map((model) => model.id))); }));
    });
    await Promise.all(refreshes);
    expect(notifiedCatalogs).toEqual([["first"]]);
    await service.dispose();
    await writeFile(path, catalog("second"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(notifiedCatalogs).toEqual([["first"]]);
    expect(service.getCliConfigState().defaultModelId).toBe("first");
  });
});
