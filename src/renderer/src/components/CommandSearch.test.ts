import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flattenActions } from "./CommandSearch";
import type { UiAction } from "./ui/ActionMenu";

const commandSearchSource = readFileSync(new URL("./CommandSearch.tsx", import.meta.url), "utf8");
const comparePopoverSource = readFileSync(new URL("./CompareLaunchPopover.tsx", import.meta.url), "utf8");

describe("CommandSearch & CompareLaunchPopover regression guards", () => {
  it("flattens nested command actions with breadcrumb prefixes", () => {
    const nested: UiAction[] = [
      { id: "dashboard", label: "子智能体看板", run: () => undefined },
      {
        id: "group",
        label: "面板",
        children: [{ id: "tasks", label: "任务中心", run: () => undefined }],
      },
    ];
    const flat = flattenActions(nested);
    expect(flat.map((item) => item.label)).toEqual(["子智能体看板", "面板 / 任务中心"]);
  });

  it("keeps all workbench and panel actions visible in empty-query Omni mode", () => {
    expect(commandSearchSource).toContain(".slice(0, 50)");
    expect(commandSearchSource).not.toContain("words.length ? 30 : 12");
  });

  it("wraps derived array selectors in CompareLaunchPopover with useShallow for React 19 stability", () => {
    expect(comparePopoverSource).toContain('import { useShallow } from "zustand/react/shallow"');
    expect(comparePopoverSource).toMatch(/useAppStore\(\s*useShallow\(\(state\)\s*=>/);
  });
});
