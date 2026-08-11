import { describe, expect, it, vi } from "vitest";
import { deleteCliSession } from "./cli-session-service";

describe("deleteCliSession", () => {
  it("uses the official fixed-argument session delete command", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "deleted", stderr: "" });
    await expect(deleteCliSession("grok.exe", "session-123", process.env, 60_000, run)).resolves.toMatchObject({ deleted: true });
    expect(run).toHaveBeenCalledWith("grok.exe", ["--no-auto-update", "sessions", "delete", "session-123"], process.env, 60_000);
  });

  it("rejects malformed ids before process launch", async () => {
    await expect(deleteCliSession("grok", "../outside", process.env)).rejects.toThrow("会话 ID 格式无效");
  });
});
