import { describe, expect, it } from "vitest";
import { redactSecrets } from "./log-service";

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
});
