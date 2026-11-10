import { expect, test } from "vitest";
import { boxVolume, normalizeBox, splitBox } from "../../src/blueprint/box.js";

test("normalize reversed", () => expect(normalizeBox([5, 1, 9], [0, 3, 2])).toEqual([[0, 1, 2], [5, 3, 9]]));
test("volume is inclusive", () => expect(boxVolume([0, 0, 0], [1, 2, 3])).toBe(24));
test("split respects max", () => {
  const parts = splitBox([0, 0, 0], [99, 9, 99], 32768);
  expect(parts.every(([a, b]) => boxVolume(a, b) <= 32768)).toBe(true);
  expect(parts.reduce((s, [a, b]) => s + boxVolume(a, b), 0)).toBe(100000);
});
test("small box not split", () => expect(splitBox([0, 0, 0], [1, 1, 1], 100)).toEqual([[[0, 0, 0], [1, 1, 1]]]));
