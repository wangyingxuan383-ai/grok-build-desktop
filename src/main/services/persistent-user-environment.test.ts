import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistentUserEnvironment } from "./provider-service";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  delete process.env.GROK_DESKTOP_PROVIDER_TEST_KEY;
});

class FakeCipher {
  encrypt(value: string): string { return Buffer.from(value, "utf8").toString("base64"); }
  decrypt(value: string): string { return Buffer.from(value, "base64").toString("utf8"); }
}

describe("PersistentUserEnvironment", () => {
  it("encrypts provider secrets on disk and reloads them after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-provider-env-"));
    roots.push(root);
    const first = new PersistentUserEnvironment(root, new FakeCipher());
    await first.write("GROK_DESKTOP_PROVIDER_TEST_KEY", "secret-value");
    expect(process.env.GROK_DESKTOP_PROVIDER_TEST_KEY).toBe("secret-value");
    expect(await first.read("GROK_DESKTOP_PROVIDER_TEST_KEY")).toBe("secret-value");

    const vault = await readFile(join(root, "provider-env.vault.json"), "utf8");
    expect(vault).not.toContain("secret-value");
    expect(JSON.parse(vault).GROK_DESKTOP_PROVIDER_TEST_KEY).toBe(Buffer.from("secret-value", "utf8").toString("base64"));

    delete process.env.GROK_DESKTOP_PROVIDER_TEST_KEY;
    const second = new PersistentUserEnvironment(root, new FakeCipher());
    expect(await second.readFresh("GROK_DESKTOP_PROVIDER_TEST_KEY")).toBe("secret-value");
    expect(process.env.GROK_DESKTOP_PROVIDER_TEST_KEY).toBe("secret-value");
    const cleared = await readFile(join(root, "provider-env.vault.json"), "utf8");
    expect(cleared).toContain("GROK_DESKTOP_PROVIDER_TEST_KEY"); // key name is still present

    await second.write("GROK_DESKTOP_PROVIDER_TEST_KEY", undefined);
    expect(await second.read("GROK_DESKTOP_PROVIDER_TEST_KEY")).toBeUndefined();
    const afterClear = JSON.parse(await readFile(join(root, "provider-env.vault.json"), "utf8")) as Record<string, string>;
    expect(afterClear.GROK_DESKTOP_PROVIDER_TEST_KEY).toBeUndefined();
  });
});
