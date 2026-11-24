import { describe, expect, it } from "vitest";
import { detectSecrets, redactDetectedSecrets } from "./SecretGuardBar";

describe("SecretGuardBar client-side secret detection & redaction", () => {
  it("detects xAI, OpenAI/Anthropic, GitHub tokens, PEM private keys, and DB connection strings", () => {
    const sample = [
      "XAI_KEY: xai-1234567890abcdef12345678",
      "OPENAI: sk-proj-abcdefghijklmnopqrstuvwx123456",
      "GH: ghp_1234567890abcdefghijklmnopqrstuv",
      "DATABASE_URL=postgres://admin:superSecretPass99@example.com:5432/prod",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    const findings = detectSecrets(sample);
    const kinds = new Map(findings.map((f) => [f.kind, f.count]));
    expect(kinds.get("private-key")).toBe(1);
    expect(kinds.get("api-key")).toBe(3);
    expect(kinds.get("env-secret")).toBe(1);

    const redacted = redactDetectedSecrets(sample);
    expect(redacted.redactedCount).toBeGreaterThanOrEqual(5);
    expect(redacted.text).not.toContain("xai-1234567890abcdef12345678");
    expect(redacted.text).not.toContain("superSecretPass99");
    expect(redacted.text).toContain("postgres://admin:[REDACTED]@example.com:5432/prod");
    expect(redacted.text).toContain("[REDACTED_PRIVATE_KEY]");
  });

  it("ignores .env.example placeholders and short harmless strings", () => {
    const benign = [
      "API_KEY=your_api_key_here",
      "OPENAI_API_KEY=your-key",
      "CLIENT_SECRET=placeholder",
      "WEBHOOK_SECRET=${WEBHOOK_SECRET}",
      "AUTH_TOKEN=<insert-token>",
    ].join("\n");

    expect(detectSecrets(benign)).toEqual([]);
    const redacted = redactDetectedSecrets(benign);
    expect(redacted.redactedCount).toBe(0);
    expect(redacted.text).toBe(benign);
  });

  it("detects standalone API_KEY= assignments and quoted secrets containing #", () => {
    const sample = [
      'API_KEY="mySuperSecretKey#withHash987654"',
      "SECRET_KEY=standaloneRealSecretValue123456",
    ].join("\n");

    const findings = detectSecrets(sample);
    expect(findings.find((f) => f.kind === "env-secret")?.count).toBe(2);

    const redacted = redactDetectedSecrets(sample);
    expect(redacted.redactedCount).toBe(2);
    expect(redacted.text).not.toContain("mySuperSecretKey#withHash987654");
    expect(redacted.text).not.toContain("standaloneRealSecretValue123456");
  });
});
