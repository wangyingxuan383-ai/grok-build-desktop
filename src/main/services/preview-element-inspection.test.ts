import { expect, it } from "vitest";
import { boundedPreviewElement, previewElementInspectionScript } from "./preview-element-inspection";

it("allows normalized points only and has no user-supplied executable code", () => {
  for (const point of [[NaN, 0], [Infinity, .1], [-.1, 0], [1, .2], [".1);alert(1)//", 0]]) expect(() => previewElementInspectionScript(point[0] as number, point[1] as number)).toThrow();
  const code = previewElementInspectionScript(.25, .75);
  expect(code).toContain("document.elementFromPoint");
  expect(code).toContain("CSS.escape");
  expect(code).not.toContain("addEventListener");
  expect(code).toMatch(/\)\(0\.25,0\.75\)$/);
});

it("rejects forged or unbounded results and returns detached data", () => {
  const valid = { selector: "html:nth-of-type(1) > body:nth-of-type(1)", text: "visible content", bounds: { x: .1, y: .2, width: .4, height: .5 } };
  expect(boundedPreviewElement(valid)).toEqual(valid);
  for (const value of [null, { ...valid, text: "x".repeat(2001) }, { ...valid, bounds: { ...valid.bounds, x: NaN } }, { ...valid, selector: "" }]) expect(() => boundedPreviewElement(value)).toThrow();
  const copy = boundedPreviewElement(valid); copy.bounds.x = 1; expect(valid.bounds.x).toBe(.1);
});
