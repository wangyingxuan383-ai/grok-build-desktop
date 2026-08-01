import { describe, expect, it } from "vitest";
import { TerminalService } from "./terminal-service";

describe("TerminalService", () => {
  it("runs shell syntax through an explicit platform shell", async () => {
    const service = new TerminalService({ ...process.env });
    const { terminalId } = service.create({ command: "echo terminal-ok" });
    expect(await service.waitForExit(terminalId)).toEqual({ exitCode: 0 });
    expect(service.output(terminalId).output).toContain("terminal-ok");
    service.release(terminalId);
  });
});
