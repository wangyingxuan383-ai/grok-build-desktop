import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OnboardingService } from "./onboarding-service";

describe("OnboardingService", () => {
  it("persists bounded progress and can reset", async () => {
    const root = await mkdtemp(join(tmpdir(), "onboarding-"));
    const service = new OnboardingService(root);
    expect((await service.get()).completed).toBe(false);
    expect((await service.update({ currentStep: 99, skipped: true })).currentStep).toBe(6);
    expect((await new OnboardingService(root).get()).skipped).toBe(true);
    expect((await service.reset()).skipped).toBe(false);
  });
});
