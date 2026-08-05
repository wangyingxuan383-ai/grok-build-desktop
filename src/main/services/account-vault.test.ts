import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AccountVault } from "./account-vault";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("AccountVault transactions", () => {
  it("does not lose accounts added concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-account-vault-"));
    roots.push(root);
    const vault = new AccountVault(root);
    await Promise.all([
      vault.addApiKey("first", "secret-first"),
      vault.addApiKey("second", "secret-second"),
      vault.addApiKey("third", "secret-third"),
    ]);
    expect((await vault.list()).map((value) => value.label).sort()).toEqual(["first", "second", "third"]);
  });

  it("merges concurrent MCP secret namespaces atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-account-vault-"));
    roots.push(root);
    const vault = new AccountVault(root);
    await Promise.all([
      vault.setMcpSecrets("alpha", { token: "secret-alpha" }),
      vault.setMcpSecrets("beta", { key: "secret-beta" }),
    ]);
    expect(await vault.mcpSecretEnvironment()).toEqual({
      GROK_DESKTOP_MCP_ALPHA_TOKEN: "secret-alpha",
      GROK_DESKTOP_MCP_BETA_KEY: "secret-beta",
    });
  });
});
