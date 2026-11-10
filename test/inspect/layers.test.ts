import { describe, expect, test } from "vitest";
import { listBlocks, renderLayers } from "../../src/inspect/layers.js";
import type { BlockReader } from "../../src/blueprint/verify.js";
import { NotLoadedError, UserFacingError } from "../../src/errors.js";
import { posKey, type BlockSpec } from "../../src/types.js";

const w = new Map<string, BlockSpec>([
  ["0,0,0", { name: "stone", state: {} }],
  ["1,0,0", { name: "air", state: {} }],
  ["0,0,1", { name: "glass", state: {} }],
  ["1,0,1", { name: "stone", state: {} }],
]);
const r: BlockReader = (p) => w.get(posKey(p)) ?? null;

describe("layers", () => {
  test("render", () =>
    expect(renderLayers([0, 0, 0], [1, 0, 1], r)).toEqual({
      legend: { ".": "air", A: "stone", B: "glass" },
      layers: [{ y: 0, rows: ["A.", "BA"] }],
    }));
  test("legend omits air when absent", () => {
    expect(renderLayers([0, 0, 1], [1, 0, 1], r).legend).toEqual({ A: "glass", B: "stone" });
  });
  test("list skips air", () => {
    const l = listBlocks([0, 0, 0], [1, 0, 1], r);
    expect(l.airCount).toBe(1);
    expect(l.blocks).toHaveLength(3);
    expect(l.blocks[0]).toEqual({ pos: [0, 0, 0], block: "stone" });
  });
  test("unloaded throws NotLoadedError", () => {
    expect(() => renderLayers([5, 0, 5], [5, 0, 5], r)).toThrow(NotLoadedError);
    expect(() => listBlocks([5, 0, 5], [5, 0, 5], r)).toThrow(NotLoadedError);
  });
  test("more than 62 kinds throws", () => {
    const many: BlockReader = (p) => ({ name: `b${p[0]}`, state: {} });
    expect(() => renderLayers([0, 0, 0], [62, 0, 0], many)).toThrow(UserFacingError);
    expect(() => renderLayers([0, 0, 0], [61, 0, 0], many)).not.toThrow();
  });
});
