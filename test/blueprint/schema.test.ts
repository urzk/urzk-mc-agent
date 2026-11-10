import { expect, test } from "vitest";
import { BlueprintSchema, resolveBlock } from "../../src/blueprint/schema.js";

test("rejects unknown op", () => expect(BlueprintSchema.safeParse({ ops: [{ op: "boom" }] }).success).toBe(false));
test("palette default", () => expect(BlueprintSchema.parse({ ops: [] }).palette).toEqual({}));
test("resolveBlock palette then literal", () => {
  const bp = BlueprintSchema.parse({ palette: { S: "stone" }, ops: [] });
  expect(resolveBlock(bp, "S")).toEqual({ name: "stone", state: {} });
  expect(resolveBlock(bp, "glass")).toEqual({ name: "glass", state: {} });
});
test("rejects multi-char palette key", () =>
  expect(BlueprintSchema.safeParse({ palette: { SS: "stone" }, ops: [] }).success).toBe(false));
test("rejects non-integer coordinates", () =>
  expect(BlueprintSchema.safeParse({ ops: [{ op: "set", at: [0.5, 0, 0], block: "stone" }] }).success).toBe(false));
