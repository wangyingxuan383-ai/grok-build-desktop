import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ nativeImage: {} }));
import { paintStatusDot } from "./tray-icon";
it("marks the connected tray icon with an opaque corner dot and leaves the rest untouched", () => {
  const size = 32, bitmap = Buffer.alloc(size * size * 4, 7);
  paintStatusDot(bitmap, size, [52, 199, 89]);
  const at = (x: number, y: number) => [...bitmap.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const r = size * 0.22, c = Math.floor(size - r - 0.5);
  expect(at(c, c)).toEqual([89, 199, 52, 255]);
  expect(at(2, 2)).toEqual([7, 7, 7, 7]);
});
