import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LogService, redactLogText, redactSecrets } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("log redaction", () => {
  it("removes authorization headers, tokens and xAI keys", () => {
    const input = [
      "Authorization: Bearer abc.def.ghi",
      'refresh_token="refresh-secret"',
      "xai_api_key='sk-this-is-a-secret-value'",
      "standalone sk-another-secret-key",
      "standalone xai-another-secret-key",
      "https://example.test/callback?access_token=query-secret&state=ok",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature12345",
    ].join("\n");
    const output = redactSecrets(input);
    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain("refresh-secret");
    expect(output).not.toContain("sk-this-is-a-secret-value");
    expect(output).not.toContain("sk-another-secret-key");
    expect(output).not.toContain("xai-another-secret-key");
    expect(output).not.toContain("query-secret");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(output).toContain("[REDACTED]");
  });

  it("removes local paths, email addresses and private URL details from persistent logs", () => {
    const output = redactLogText([
      "cwd=E:\\Users\\wang\\Documents\\GROK",
      "cwd=D:\\Workspace With Space\\private folder\\file.ts",
      'file="C:\\Users\\wang\\AppData\\Roaming\\secret.json"',
      "owner=yu715034@example.com",
      "upstream=http://127.0.0.1:8080/v1/responses?token=secret",
    ].join("\n"));
    expect(output).not.toContain("wang");
    expect(output).not.toContain("secret.json");
    expect(output).not.toContain("With Space");
    expect(output).not.toContain("yu715034");
    expect(output).not.toContain("/v1/responses");
    expect(output).toContain("[REDACTED_PATH]");
    expect(output).toContain("[REDACTED_EMAIL]");
    expect(output).toContain("http://127.0.0.1:<port>");
  });

  it("sanitizes an existing log once and keeps only one bounded backup on rotation", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-log-"));
    roots.push(root);
    const path = join(root, "app.log");
    await writeFile(path, "old C:\\Users\\private\\workspace\\file.ts\n", "utf8");
    const log = new LogService(path, 110);
    await log.log("first short line");
    expect(await readFile(path, "utf8")).not.toContain("private");
    await log.log("x".repeat(90));
    expect(await readFile(`${path}.1`, "utf8")).toContain("[REDACTED_PATH]");
    expect((await readFile(path, "utf8")).length).toBeGreaterThan(0);
  });
});
