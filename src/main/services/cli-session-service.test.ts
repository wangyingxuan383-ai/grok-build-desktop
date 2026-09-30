import { describe, expect, it, vi } from "vitest";
import { deleteCliSession } from "./cli-session-service";

describe("deleteCliSession", () => {
  it("matches the full deleted identity rather than a prefix or embedded message", async () => {
    for (const stdout of ["Deleted session session-123-other", "Warning: Deleted session session-123", "Deleted session session-123\nAccess denied"]) {
      await expect(deleteCliSession("fixture.exe", "session-123", {}, 1, async () => ({ stdout, stderr: "" }))).rejects.toThrow("未确认删除");
    }
    await expect(deleteCliSession("fixture.exe", "session-123", {}, 1, async () => ({ stdout: "Deleted session session-123.", stderr: "" }))).resolves.toMatchObject({ deleted: true });
  });
  it.each(["No session found with id other-session.", "", "unexpected response"])("does not accept exit zero without deletion confirmation: %s", async (stdout) => {
    await expect(deleteCliSession("fixture.exe", "session-123", {}, 1, async () => ({ stdout, stderr: "" }))).rejects.toThrow("未确认删除");
  });
  it("uses the official fixed-argument session delete command", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "deleted", stderr: "" });
    await expect(deleteCliSession("grok.exe", "session-123", process.env, 60_000, run)).resolves.toMatchObject({ deleted: true });
    expect(run).toHaveBeenCalledWith("grok.exe", ["--no-auto-update", "sessions", "delete", "session-123"], process.env, 60_000);
  });

  it("rejects malformed ids before process launch", async () => {
    await expect(deleteCliSession("grok", "../outside", process.env)).rejects.toThrow("会话 ID 格式无效");
  });
});

it("accepts the exact already absent receipt without treating arbitrary errors as absence", async () => {
 await expect(deleteCliSession("fixture.exe","session-123",{},1,async()=>({stdout:"No session found with id session-123.",stderr:""}))).resolves.toMatchObject({alreadyAbsent:true,deleted:false});
 await expect(deleteCliSession("fixture.exe","session-123",{},1,async()=>{throw Error("Access denied")})).rejects.toThrow("Access denied");
});
