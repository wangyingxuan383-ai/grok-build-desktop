import { describe, expect, it } from "vitest";
import { DiagnosticsService, redactDiagnosticText } from "./diagnostics-service";

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

  it("explicitly excludes theme backgrounds and their local paths from support bundles", () => {
    const service = new DiagnosticsService("D:\\AppData", {} as never, async () => ({} as never), async () => undefined, async () => ({ available: false, diagnostics: [] } as never), {} as never);
    const excluded = service.preview().excluded.join("\n");
    expect(excluded).toContain("主题背景图片");
    expect(excluded).toContain("主题背景原始路径");
    expect(excluded).toContain("提供商端点");
    expect(excluded).toContain("任务提示词");
    expect(excluded).toContain("会话附件正文");
    expect(excluded).toContain("Base64");
    expect(excluded).toContain("Memory 内容、文件路径和索引");
  });
});
