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

  it("redacts adversarial authorization, Base64, query, env and UNC secrets", () => {
    const opaque = Buffer.from("a deliberately long gateway credential value").toString("base64");
    const output = redactLogText([
      "Authorization: Basic dXNlcjpzdXBlci1zZWNyZXQ=",
      "Proxy-Authorization=Token proxy-secret-value",
      `opaque=${opaque}`,
      "https://example.test/v1?signature=private-signature&next=ok",
      "CUSTOM_GATEWAY_PASSWORD='env-secret'",
      "UNC=\\\\private-server\\private-share\\customer\\file.txt",
      "path=C:\\Users\\private-user\\AppData\\secret.json",
    ].join("\n"));
    for (const secret of ["dXNlcjpzdXBlci1zZWNyZXQ=", "proxy-secret-value", opaque, "private-signature", "env-secret", "private-server", "private-user"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("REDACTED");
  });

  it("redacts quoted credentials with spaces and custom header or environment containers", () => {
    const output = redactSecrets([
      '"Authorization" : "Bearer token with spaces and punctuation.!"',
      "Proxy-Authorization = 'Basic user password with spaces'",
      'X_API_KEY = "custom api key with spaces"',
      'headers={"X-Tenant-Cred":"header value unknown to the app","Trace":"safe-looking-but-private"}',
      'environment: {"UNUSUAL_PROVIDER_FIELD":"custom env value","NORMAL":"also private"}',
      'env.ARBITRARY_PROVIDER_FIELD="standalone custom env value"',
      "Request Header X-Arbitrary-Provider: standalone custom header value",
      '--header "X-Another-Name: command line header value"',
      "https://user:password@example.invalid/callback?api_key=query-value&code=oauth-code&state=visible",
    ].join("\n"));
    for (const secret of [
      "token with spaces",
      "user password with spaces",
      "custom api key with spaces",
      "header value unknown",
      "safe-looking-but-private",
      "custom env value",
      "also private",
      "standalone custom env value",
      "standalone custom header value",
      "command line header value",
      "user:password",
      "query-value",
      "oauth-code",
    ]) expect(output).not.toContain(secret);
    expect(output).toContain("state=visible");
  });

  it("redacts quoted, unquoted, extended and forward-slash Windows or UNC paths", () => {
    const output = redactLogText([
      'file="C:\\Users\\Private Name\\AppData\\secret file.json"',
      "extended=\\\\?\\C:\\Users\\Hidden\\workspace\\file.ts",
      "unc=\\\\server-name\\share name\\customer\\file.txt",
      "forward=C:/Users/Forward Name/Documents/private.txt",
      'network="//nas-name/private share/customer/file.txt"',
    ].join("\n"));
    for (const value of ["Private Name", "Hidden", "server-name", "share name", "Forward Name", "nas-name", "private share"]) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain("REDACTED_PATH");
    expect(output).toContain("REDACTED_NETWORK_PATH");
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
