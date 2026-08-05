import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRuntimeHandshake } from "./grok-acp-adapter";

async function fixture(version: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", `initialize-${version}.json`), "utf8"));
}

describe("CLI runtime handshake fixtures", () => {
  it.each(["0.2.117", "0.2.118", "0.2.120"])("normalizes %s without retaining unknown payloads", async (version) => {
    const value = await fixture(version);
    value.unrecognizedFutureField = { prompt: "must-not-be-saved" };
    const handshake = normalizeRuntimeHandshake(value);
    expect(handshake.agentVersion).toBe(version);
    expect(handshake.protocolVersion).toBe(1);
    expect(JSON.stringify(handshake)).not.toContain("must-not-be-saved");
  });

  it("gates forward features from runtime declarations rather than a version number", async () => {
    const oldHandshake = normalizeRuntimeHandshake(await fixture("0.2.118"));
    const forward = normalizeRuntimeHandshake(await fixture("0.2.120"));
    expect(oldHandshake.extensions).not.toContain("x.ai/btw");
    expect(forward.extensions).toEqual(expect.arrayContaining(["x.ai/btw", "x.ai/recap", "x.ai/fs_notify", "x.ai/pluginDirs"]));
    expect(forward.extensions).not.toContain("x.ai/follow_ups");
    expect(forward.sessionCapabilities).toMatchObject({ close: true, list: true, resume: true });
    expect(forward.models[0]?.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
  });
});
