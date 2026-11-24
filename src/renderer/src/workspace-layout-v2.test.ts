import { describe, expect, it } from "vitest";
import {
  MAX_LAYOUT_GROUPS,
  activeGroup,
  applyGridPreset,
  closeLayoutGroup,
  createLayoutGroup,
  detectGridPreset,
  focusPaneByIndex,
  groupToLayout,
  initialLayout,
  initialLayoutV2,
  leaves,
  openTarget,
  renameLayoutGroup,
  restoreLayout,
  restoreLayoutStateV2,
  setPaneSurfaceMode,
  switchLayoutGroup,
  togglePaneZoom,
  type ContentTarget,
} from "./workspace-layout";

const sampleSession = (id: string): ContentTarget => ({
  kind: "session",
  workspace: "D:\\repo\\alpha",
  id,
  title: `Session ${id}`,
});

describe("workspace-layout V2 & Mirasim Stage presets", () => {
  it("migrates persisted V1 layout seamlessly into V2 group state", () => {
    let v1 = initialLayout();
    v1 = openTarget(v1, "main", sampleSession("s1"));
    v1 = applyGridPreset(v1, "1x2", [sampleSession("s1"), sampleSession("s2")]);

    const v2 = restoreLayoutStateV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.groups).toHaveLength(1);
    const groupLayout = groupToLayout(activeGroup(v2));
    expect(detectGridPreset(groupLayout.root)).toBe("1x2");
    expect(leaves(groupLayout.root)).toHaveLength(2);
  });

  it("applies 1x1, 1x2, 2x1, and 2x2 grid presets deterministically and merges tabs back on 1x1", () => {
    const targets = [sampleSession("a"), sampleSession("b"), sampleSession("c"), sampleSession("d")];
    let layout = openTarget(initialLayout(), "main", targets[0]!);

    layout = applyGridPreset(layout, "2x2", targets);
    expect(detectGridPreset(layout.root)).toBe("2x2");
    expect(leaves(layout.root)).toHaveLength(4);

    layout = applyGridPreset(layout, "2x1");
    expect(detectGridPreset(layout.root)).toBe("2x1");
    expect(leaves(layout.root)).toHaveLength(2);

    layout = applyGridPreset(layout, "1x1");
    expect(detectGridPreset(layout.root)).toBe("1x1");
    const singleLeaf = leaves(layout.root)[0]!;
    expect(singleLeaf.tabs.map((t) => t.id)).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
  });

  it("supports single-pane zoom toggle and per-pane chat/pty surface switching", () => {
    let layout = applyGridPreset(initialLayout(), "1x2", [sampleSession("s1"), sampleSession("s2")]);
    const [first, second] = leaves(layout.root);
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    layout = togglePaneZoom(layout, second!.id);
    expect(layout.zoomedPaneId).toBe(second!.id);
    expect(layout.focusedPane).toBe(second!.id);

    layout = focusPaneByIndex(layout, 0);
    expect(layout.focusedPane).toBe(first!.id);
    expect(layout.zoomedPaneId).toBe(first!.id);

    layout = togglePaneZoom(layout, first!.id);
    expect(layout.zoomedPaneId).toBeUndefined();

    layout = setPaneSurfaceMode(layout, second!.id, "pty");
    const restored = restoreLayout(layout);
    expect(leaves(restored.root).find((p) => p.id === second!.id)?.surfaceMode).toBe("pty");
  });

  it("manages layout groups up to MAX_LAYOUT_GROUPS with cyclic switching and safe close", () => {
    let state = initialLayoutV2();
    for (let i = 2; i <= MAX_LAYOUT_GROUPS + 2; i += 1) {
      state = createLayoutGroup(state, `组 ${i}`, sampleSession(`s-${i}`));
    }
    expect(state.groups).toHaveLength(MAX_LAYOUT_GROUPS);
    expect(state.activeGroupId).toBe(`group-${MAX_LAYOUT_GROUPS}`);

    state = switchLayoutGroup(state, 1);
    expect(state.activeGroupId).toBe("group-1");

    state = renameLayoutGroup(state, "group-1", "主力对比台");
    expect(activeGroup(state).name).toBe("主力对比台");

    state = closeLayoutGroup(state, "group-1");
    expect(state.groups).toHaveLength(MAX_LAYOUT_GROUPS - 1);
    expect(state.groups.some((g) => g.id === "group-1")).toBe(false);
  });
});
