import { expect, test } from "vitest";
import { BlueprintSchema } from "../../src/blueprint/schema.js";
import { expandBlueprint } from "../../src/blueprint/expand.js";

test("later ops overwrite", () => {
  const bp = BlueprintSchema.parse({ ops: [
    { op: "fill", from: [0, 0, 0], to: [1, 0, 1], block: "stone" },
    { op: "set", at: [1, 0, 1], block: "glass" }] });
  const { voxels } = expandBlueprint(bp);
  expect(voxels.size).toBe(4);
  expect(voxels.get("1,0,1")).toEqual({ name: "glass", state: {} });
});
test("hollow interior is air", () => {
  const { voxels } = expandBlueprint(BlueprintSchema.parse({ ops: [{ op: "hollow", from: [0, 0, 0], to: [2, 2, 2], block: "stone" }] }));
  expect(voxels.get("1,1,1")!.name).toBe("air");
  expect(voxels.get("0,1,1")!.name).toBe("stone");
});
test("reversed fill same as forward", () => {
  const a = expandBlueprint(BlueprintSchema.parse({ ops: [{ op: "fill", from: [2, 0, 2], to: [0, 0, 0], block: "stone" }] }));
  expect(a.voxels.size).toBe(9);
});
test("layers: unknown char unchanged, x from char index", () => {
  const { voxels } = expandBlueprint(BlueprintSchema.parse({ palette: { S: "stone", ".": "air" },
    ops: [{ op: "layers", at: [10, 0, 0], rows: [["S.", " S"]] }] }));
  expect(voxels.get("10,0,0")!.name).toBe("stone");
  expect(voxels.get("11,0,0")!.name).toBe("air");
  expect(voxels.has("10,0,1")).toBe(false);
  expect(voxels.get("11,0,1")!.name).toBe("stone");
});
test("we op skipped", () => expect(expandBlueprint(BlueprintSchema.parse({ ops: [{ op: "we", command: "//sphere glass 3" }] })).skippedOps).toEqual([0]));
test("thin hollow box is fully shell", () => {
  const { voxels } = expandBlueprint(BlueprintSchema.parse({ ops: [{ op: "hollow", from: [0, 0, 0], to: [1, 1, 1], block: "stone" }] }));
  expect([...voxels.values()].every((b) => b.name === "stone")).toBe(true);
});

test("replace fill skipped", () => {
  const r = expandBlueprint(
    BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [1, 0, 0], block: "stone", replace: "dirt" }] }),
  );
  expect(r.skippedOps).toEqual([0]);
  expect(r.voxels.size).toBe(0);
});

test("replace fill rewrites matching voxels from earlier ops", () => {
  const r = expandBlueprint(
    BlueprintSchema.parse({
      ops: [
        { op: "fill", from: [0, 0, 0], to: [2, 0, 0], block: "stone" },
        { op: "set", at: [1, 0, 0], block: "glass" },
        { op: "set", at: [5, 0, 0], block: "glass" },
        { op: "fill", from: [0, 0, 0], to: [2, 0, 0], block: "tinted_glass", replace: "glass" },
      ],
    }),
  );
  expect(r.skippedOps).toEqual([3]);
  expect([0, 1, 2, 5].map((x) => r.voxels.get(`${x},0,0`)?.name)).toEqual(["stone", "tinted_glass", "stone", "glass"]);
});
