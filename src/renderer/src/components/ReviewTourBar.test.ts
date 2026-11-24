import { describe, expect, it } from "vitest";
import type { GitReviewFileSummary } from "../../../shared/types";
import {
  buildReviewTour,
  classifyReviewTourGroup,
  evaluatePriorityFlag,
  viewedFileSignature,
} from "./ReviewTourBar";

function makeFile(
  path: string,
  overrides: Partial<GitReviewFileSummary> = {},
): GitReviewFileSummary {
  return {
    id: path,
    path,
    kind: "modified",
    staged: false,
    workingTree: true,
    additions: 10,
    deletions: 2,
    binary: false,
    hunkCount: 1,
    ...overrides,
  };
}

describe("ReviewTourBar heuristics", () => {
  it("classifies files into the 5 semantic architectural tour groups", () => {
    expect(classifyReviewTourGroup("src/shared/types.ts").id).toBe("contracts");
    expect(classifyReviewTourGroup("src/preload/index.ts").id).toBe("contracts");
    expect(classifyReviewTourGroup("src/main/services/git-checkpoint-service.ts").id).toBe("backend");
    expect(classifyReviewTourGroup("src/renderer/src/components/ReviewPane.tsx").id).toBe("ui");
    expect(classifyReviewTourGroup("src/main/services/git-checkpoint-service.test.ts").id).toBe("tests");
    expect(classifyReviewTourGroup("package-lock.json").id).toBe("config");
  });

  it("flags security/IPC/conflict/high-churn files as priority while ignoring lockfiles", () => {
    expect(evaluatePriorityFlag(makeFile("package-lock.json", { additions: 900, deletions: 400 })).priority).toBe(false);
    expect(evaluatePriorityFlag(makeFile("src/main/ipc-schema.ts")).priority).toBe(true);
    expect(evaluatePriorityFlag(makeFile("src/renderer/src/conflict.ts", { kind: "conflicted" })).priority).toBe(true);
    expect(evaluatePriorityFlag(makeFile("src/renderer/src/big.tsx", { additions: 70, deletions: 25 })).priority).toBe(true);
  });

  it("orders buildReviewTour deterministically: contracts -> backend -> ui -> tests -> config", () => {
    const files = [
      makeFile("package.json"),
      makeFile("src/renderer/src/App.tsx", { additions: 30, deletions: 5 }),
      makeFile("src/main/services/helper.test.ts"),
      makeFile("src/main/services/helper.ts"),
      makeFile("src/shared/workbench-types.ts"),
    ];
    const tour = buildReviewTour(files);
    expect(tour.map((item) => item.group.id)).toEqual([
      "contracts",
      "backend",
      "ui",
      "tests",
      "config",
    ]);
  });

  it("produces change-sensitive signatures so re-edited files become unviewed automatically", () => {
    const before = viewedFileSignature(makeFile("src/a.ts", { additions: 4, deletions: 1 }));
    const after = viewedFileSignature(makeFile("src/a.ts", { additions: 9, deletions: 1 }));
    expect(before).not.toBe(after);
  });
});
