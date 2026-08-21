import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomProviderProfile } from "../../shared/types";
import { ProviderProfileRecoveryStore } from "./provider-profile-recovery-store";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "provider-recovery-")); roots.push(value); return value; }
const profile: CustomProviderProfile = { id: "provider", enabled: true, name: "Provider", baseUrl: "https://example.test/v1", protocol: "responses", upstreamProtocol: "openai_responses", schemaProfile: "strict", compatibilityFlavor: "generic", proxyMode: "inherit", authScheme: "bearer", credentialMode: "none", extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };

describe("ProviderProfileRecoveryStore", () => {
  it("restores only an empty corrupt primary from a matching anchored backup", async () => {
    const userData = await root();
    const service = new ProviderProfileRecoveryStore(userData);
    await service.save([profile]);
    await writeFile(join(userData, "providers.json.corrupt-1-00000000-0000-0000-0000-000000000000.bak"), "broken");
    await expect(service.recoverIfEligible([])).resolves.toEqual([profile]);
    await expect(service.recoverIfEligible([profile])).resolves.toBeUndefined();
  });

  it("refuses recovery without corruption evidence or when the identity anchor differs", async () => {
    const userData = await root();
    const service = new ProviderProfileRecoveryStore(userData);
    await service.save([profile]);
    await expect(service.recoverIfEligible([])).resolves.toBeUndefined();
    await writeFile(join(userData, "providers.json.corrupt-2-00000000-0000-0000-0000-000000000000.bak"), "broken");
    const anchorsPath = join(userData, "provider-identity-anchors.json");
    const anchors = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(anchorsPath, "utf8")));
    anchors.identities[0].endpoint = "https://evil.test/";
    await writeFile(anchorsPath, JSON.stringify(anchors));
    await expect(new ProviderProfileRecoveryStore(userData).recoverIfEligible([])).resolves.toBeUndefined();
  });

  it("never duplicates credentials embedded in a legacy endpoint into the recovery files", async () => {
    const userData = await root();
    const service = new ProviderProfileRecoveryStore(userData);
    await expect(service.save([{ ...profile, baseUrl: "https://u:p@localhost/v1" }])).rejects.toThrow("内嵌凭据");
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(join(userData, "providers.last-known-good.json"), "utf8"))).rejects.toThrow();
  });
});
