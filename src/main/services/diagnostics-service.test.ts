import { describe, expect, it } from "vitest";
import { redactDiagnosticText } from "./diagnostics-service";

describe("diagnostic redaction", () => {
  it("removes credentials, user paths, emails and proxy details", () => {
    const output = redactDiagnosticText("C:\\Users\\TestUser\\secret token xai-FAKE_TEST_SECRET_123456 mail person@example.com proxy http://user:pass@127.0.0.1:8080/path\nD:\\Workspace With Space\\secret.txt");
    expect(output).not.toContain("TestUser");
    expect(output).not.toContain("FAKE_TEST_SECRET");
    expect(output).not.toContain("person@example.com");
    expect(output).not.toContain("Workspace With Space");
    expect(output).not.toContain("user:pass");
    expect(output).not.toContain("/path");
  });
});
