import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSupportBundleArchive, DiagnosticsService, parseGrokDiskUsage, parseGrokDoctorFixes, redactDiagnosticText } from "./diagnostics-service";

describe("diagnostic redaction", () => {
  it("exports an explicit local session trace with fixed arguments", async () => {
    const output = join(tmpdir(), `grok-trace-test-${randomUUID()}.json`);
    const runner = vi.fn(async (_cliPath: string, args: string[]) => {
      await writeFile(String(args[args.indexOf("-o") + 1]), "{}", "utf8");
      return { stdout: "", stderr: "" };
    });
    const service = new DiagnosticsService(
      "C:\\AppData", {} as never, async () => ({}) as never, async () => undefined,
      async () => ({ available: false, diagnostics: [] }) as never, {} as never, "C:\\fake-grok.exe",
      { traceCommandRunner: runner },
    );
    try {
      await service.exportSessionTrace("019f-session_test", output);
      expect(runner).toHaveBeenCalledWith("C:\\fake-grok.exe", ["--no-auto-update", "trace", "--local", "--json", "-o", output, "019f-session_test"], expect.objectContaining({ timeout: 300_000 }));
    } finally { await rm(output, { force: true }); }
  });
  it("normalizes bounded grok du JSON without exposing paths", () => {
    expect(parseGrokDiskUsage({
      total_bytes: 5 * 1024 * 1024,
      top_level_dirs: [{ name: "sessions", bytes: 4 * 1024 * 1024 }, { name: "cache", bytes: 1024 }],
      worktrees: [{ id: "one" }],
      skipped_entries: 1,
    })).toEqual(expect.objectContaining({
      id: "grok-du",
      status: "warning",
      summary: "GROK_HOME 共 5.0 MiB · 1 个受管 Worktree",
      details: ["sessions：4.0 MiB", "cache：1.0 KiB", "1 个条目无法读取"],
    }));
  });

  it("only exposes named Grok Doctor remediations and rejects forged ids", () => {
    expect(parseGrokDoctorFixes({ findings: [
      { id: "terminal.ssh-wrap", message: "Install wrapper", automaticRemediation: { kind: "config" } },
      { id: "unsafe id; rm", message: "forged", automaticRemediation: true },
      { id: "manual-only", message: "no automatic fix", automaticRemediation: null },
    ] })).toEqual([{ id: "terminal.ssh-wrap", message: "Install wrapper" }]);
  });

  it("revalidates one-use Doctor previews and executes only fixed arguments", async () => {
    const report = JSON.stringify({ findings: [{ id: "terminal.ssh-wrap", message: "Install wrapper", automaticRemediation: { kind: "config" } }] });
    const runner = vi.fn(async (_cliPath: string, args: string[]) => args.includes("--json")
      ? { stdout: report, stderr: "" }
      : { stdout: "fixed", stderr: "" });
    const service = new DiagnosticsService(
      "C:\\AppData", {} as never, async () => ({}) as never, async () => undefined,
      async () => ({ available: false, diagnostics: [] }) as never, {} as never, "C:\\fake-grok.exe",
      { doctorCommandRunner: runner },
    );
    const preview = await service.previewDoctorFixes();
    expect(preview.confirmationToken).toBeTruthy();
    await expect(service.applyDoctorFix("terminal.ssh-wrap", preview.confirmationToken!, true)).resolves.toEqual(expect.objectContaining({ applied: true, message: "fixed" }));
    expect(runner).toHaveBeenLastCalledWith("C:\\fake-grok.exe", ["--no-auto-update", "doctor", "fix", "terminal.ssh-wrap", "--yes"], expect.objectContaining({ timeout: 60_000 }));
    await expect(service.applyDoctorFix("terminal.ssh-wrap", preview.confirmationToken!, true)).rejects.toThrow("预览已失效");
  });

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
    expect(excluded).toContain("会话重新绑定事务日志");
    expect(excluded).toContain("提供商端点");
    expect(excluded).toContain("任务提示词");
    expect(excluded).toContain("会话附件正文");
    expect(excluded).toContain("Base64");
    expect(excluded).toContain("Memory 内容、文件路径和索引");
  });

  it("redacts adversarial secrets and paths from every serialized support archive entry", () => {
    const opaque = Buffer.from("provider-secret-value-that-must-never-leak-1234567890").toString("base64");
    const archive = buildSupportBundleArchive({
      build: { productName: `Grok ${opaque}`, version: "0.7.0" } as never,
      report: {
        checkedAt: new Date().toISOString(), overall: "limited",
        items: [{
          id: "bad", label: "Authorization: Bearer hidden-token-value-123456789",
          status: "warning", summary: "C:\\Users\\Private User\\secret.txt",
          details: ["\\\\server\\private\\token.txt", "https://host.test/path?access_token=visible-secret"],
        }],
      } as never,
      httpProxyConfigured: true,
      httpsProxyConfigured: true,
      log: `API_KEY='raw-secret-value'\n${opaque}\nC:\\Users\\Private User\\secret.txt\n\\\\server\\private\\token.txt`,
    });
    const files = unzipSync(archive);
    const combined = Object.values(files).map((value) => strFromU8(value)).join("\n");
    for (const secret of [opaque, "hidden-token-value", "raw-secret-value", "Private User", "visible-secret", "server\\private"]) {
      expect(combined).not.toContain(secret);
    }
    expect(combined).toContain("[REDACTED");
  });
});

describe("failure-scoped diagnosis", () => {
  const build = { productName: "Grok Build Desktop", version: "0.0.0" } as never;
  const settings = async () => ({ cliPath: "", httpsProxy: "", httpProxy: "" }) as never;
  const failure = (patch: Record<string, unknown> = {}) => ({
    failureId: "f", at: new Date().toISOString(), classification: "schema-rejected",
    message: "GenerateContentRequest…enum[4]: cannot be empty", modelId: "acme-gemini-3-flash",
    providerId: "acme", httpStatus: 400, ...patch,
  }) as never;

  const service = (providers: unknown[] = [], quota?: unknown) => new DiagnosticsService(
    "C:\nope", build, settings, async () => undefined, async () => ({ available: false }) as never,
    { log: async () => undefined } as never, "",
    { providers: async () => providers as never, ...(quota ? { quota: async () => quota as never } : {}) },
  );

  it("names the pass-through schema profile as the cause instead of reporting a healthy install", async () => {
    const report = await service([{ id: "acme", name: "Acme", schemaProfile: "standard", hasCredential: true, baseUrl: "https://acme.test/v1", models: [] }])
      .diagnoseFailure(failure({ sanitizedCount: 0 }));
    const profile = report.items.find((item) => item.id === "schema-profile");
    expect(profile?.status).toBe("error");
    expect(profile?.summary).toContain("直通");
    // The install sweep's probes must not run for this class.
    expect(report.items.some((item) => item.id === "cli" || item.id === "models" || item.id === "dpapi")).toBe(false);
  });

  it("clears the schema check once the provider is on a sanitizing profile", async () => {
    const report = await service([{ id: "acme", name: "Acme", schemaProfile: "gemini", hasCredential: true, baseUrl: "https://acme.test/v1", models: [] }])
      .diagnoseFailure(failure({ sanitizedCount: 3 }));
    expect(report.items.find((item) => item.id === "schema-profile")?.status).toBe("ok");
  });

  it("reports only real quota windows and never invents one", async () => {
    const withQuota = await service([], { rolling24h: { label: "滚动 24 小时 Token", used: 1_056_458, limit: 1_000_000 }, currentAllowance: { label: "本期额度（周）", periodType: "weekly", unit: "percent" } })
      .diagnoseFailure(failure({ classification: "quota-exhausted", providerId: undefined }));
    expect(withQuota.items.find((item) => item.id === "quota")?.details?.[0]).toContain("1056458/1000000");
    expect(withQuota.items.find((item) => item.id === "quota")?.details?.[1]).toContain("本期额度（周）");

    const without = await service([]).diagnoseFailure(failure({ classification: "quota-exhausted", providerId: undefined }));
    expect(without.items.find((item) => item.id === "quota")?.summary).toContain("未能读取");
  });

  it("runs the CLI probes only for the class where they are the relevant evidence", async () => {
    const crashed = await service([]).diagnoseFailure(failure({ classification: "cli-crashed", processExitCode: 3, providerId: undefined }));
    expect(crashed.items.some((item) => item.id === "cli")).toBe(true);
    expect(crashed.items.find((item) => item.id === "exit")?.summary).toContain("代码 3");
  });
});
