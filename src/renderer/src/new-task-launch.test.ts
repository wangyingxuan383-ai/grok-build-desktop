import { describe, expect, it } from "vitest";
import { launchInputFromDraft } from "./new-task-launch";

describe("new task session launch", () => {
  it("removes the Desktop-only project id before invoking session:create", () => {
    const result = launchInputFromDraft({
      projectId: "project:stable-id",
      workspacePath: "C:\\workspace",
      profileId: "profile",
      modelId: "provider-model",
      providerId: "provider",
      effort: "xhigh",
      mode: "plan",
    });

    expect(result).toEqual({
      workspacePath: "C:\\workspace",
      profileId: "profile",
      modelId: "provider-model",
      providerId: "provider",
      effort: "xhigh",
      mode: "plan",
    });
    expect(result).not.toHaveProperty("projectId");
  });
});
