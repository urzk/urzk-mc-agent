import { describe, expect, test } from "vitest";
import { NotLoadedError, UserFacingError } from "../../src/errors.js";
import { BlueprintSchema } from "../../src/blueprint/schema.js";
import {
  MAX_VERIFY_VOXELS,
  blueprintBounds,
  verifyBlueprint,
  type BlockReader,
} from "../../src/blueprint/verify.js";
import { posKey, type BlockSpec } from "../../src/types.js";

const bp = BlueprintSchema.parse({
  palette: { L: "lever[powered=true]" },
  ops: [
    { op: "fill", from: [0, 0, 0], to: [1, 0, 0], block: "Minecraft:Stone" },
    { op: "set", at: [0, 1, 0], block: "L" },
  ],
});
const world = new Map<string, BlockSpec>([
  ["10,0,0", { name: "stone", state: {} }],
  ["11,0,0", { name: "dirt", state: {} }],
  ["10,1,0", { name: "lever", state: { powered: "true", facing: "north" } }],
]);
const reader: BlockReader = (p) => world.get(posKey(p)) ?? null;

describe("verifyBlueprint", () => {
  test("reports mismatches in absolute coords", () =>
    expect(verifyBlueprint(bp, [10, 0, 0], reader)).toEqual({
      checked: 3,
      mismatches: [{ pos: [11, 0, 0], expected: "stone", actual: "dirt" }],
      truncated: 0,
      skippedOps: [],
    }));

  test("throws on unloaded", () =>
    expect(() => verifyBlueprint(bp, [500, 0, 0], reader)).toThrow(NotLoadedError));

  test("truncates", () => {
    const big = BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [9, 0, 9], block: "stone" }] });
    const r = verifyBlueprint(big, [0, 0, 0], () => ({ name: "air", state: {} }));
    expect(r.mismatches).toHaveLength(50);
    expect(r.truncated).toBe(50);
  });

  test("respects maxMismatches", () => {
    const big = BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [9, 0, 9], block: "stone" }] });
    const r = verifyBlueprint(big, [0, 0, 0], () => ({ name: "air", state: {} }), { maxMismatches: 5 });
    expect(r.mismatches).toHaveLength(5);
    expect(r.truncated).toBe(95);
  });

  test("rejects huge blueprints before expanding", () => {
    const huge = BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [99, 99, 99], block: "stone" }] });
    let reads = 0;
    expect(() => verifyBlueprint(huge, [0, 0, 0], () => (reads++, null))).toThrow(UserFacingError);
    expect(() => verifyBlueprint(huge, [0, 0, 0], () => null)).toThrow(/分割|smaller/);
    expect(reads).toBe(0);
    expect(MAX_VERIFY_VOXELS).toBe(262144);
  });

  test("reports skipped we ops", () => {
    const b = BlueprintSchema.parse({ ops: [{ op: "we", command: "//undo" }, { op: "set", at: [0, 0, 0], block: "stone" }] });
    const r = verifyBlueprint(b, [0, 0, 0], () => ({ name: "stone", state: {} }));
    expect(r.skippedOps).toEqual([0]);
  });
});

describe("blueprintBounds", () => {
  test("bounds include we pos", () =>
    expect(
      blueprintBounds(
        BlueprintSchema.parse({
          ops: [
            { op: "set", at: [0, 0, 0], block: "stone" },
            { op: "we", command: "//sphere glass 3", pos: [5, 10, 5] },
          ],
        }),
        [1, 1, 1],
      ),
    ).toEqual({ min: [1, 1, 1], max: [6, 11, 6] }));

  test("normalizes reversed boxes and includes pos1/pos2", () =>
    expect(
      blueprintBounds(
        BlueprintSchema.parse({
          ops: [
            { op: "hollow", from: [3, 3, 3], to: [1, 2, 1], block: "stone" },
            { op: "we", command: "//copy", pos1: [-2, 0, 0], pos2: [0, 0, 9] },
          ],
        }),
        [10, 0, 0],
      ),
    ).toEqual({ min: [8, 0, 0], max: [13, 3, 9] }));

  test("layers extent covers palette chars only", () =>
    expect(
      blueprintBounds(
        BlueprintSchema.parse({
          palette: { a: "stone" },
          ops: [{ op: "layers", at: [0, 0, 0], rows: [["a.."], [".a."], ["..."]] }],
        }),
        [0, 0, 0],
      ),
    ).toEqual({ min: [0, 0, 0], max: [1, 1, 0] }));

  test("null when empty", () => {
    expect(blueprintBounds(BlueprintSchema.parse({ ops: [] }), [0, 0, 0])).toBeNull();
    expect(
      blueprintBounds(BlueprintSchema.parse({ ops: [{ op: "we", command: "//undo" }] }), [0, 0, 0]),
    ).toBeNull();
  });

  test("is cheap for huge blueprints", () =>
    expect(
      blueprintBounds(
        BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [9999, 255, 9999], block: "stone" }] }),
        [0, 0, 0],
      ),
    ).toEqual({ min: [0, 0, 0], max: [9999, 255, 9999] }));
});
