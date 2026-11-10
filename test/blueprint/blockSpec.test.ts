import { describe, expect, test } from "vitest";
import { blockMatches, formatBlockSpec, parseBlockSpec } from "../../src/blueprint/blockSpec.js";
import { BlueprintError } from "../../src/errors.js";

describe("blockSpec", () => {
  test("parse plain", () => expect(parseBlockSpec("stone")).toEqual({ name: "stone", state: {} }));
  test("parse with state", () =>
    expect(parseBlockSpec("oak_door[facing=south,half=lower]")).toEqual({
      name: "oak_door",
      state: { facing: "south", half: "lower" },
    }));
  test("normalizes prefix and case", () =>
    expect(parseBlockSpec("Minecraft:Stone_Bricks")).toEqual({ name: "stone_bricks", state: {} }));
  test("rejects malformed", () =>
    expect(() => parseBlockSpec("oak_door[facing]")).toThrow(BlueprintError));
  test("format", () =>
    expect(formatBlockSpec({ name: "lever", state: { powered: "true" } })).toBe("lever[powered=true]"));
  test("format plain", () => expect(formatBlockSpec({ name: "stone", state: {} })).toBe("stone"));
  test("matches partial state", () =>
    expect(
      blockMatches(
        { name: "lever", state: { powered: "true" } },
        { name: "lever", state: { powered: "true", face: "wall", facing: "north" } },
      ),
    ).toBe(true));
  test("mismatch state", () =>
    expect(
      blockMatches({ name: "lever", state: { powered: "true" } }, { name: "lever", state: { powered: "false" } }),
    ).toBe(false));
  test("mismatch name", () =>
    expect(blockMatches({ name: "stone", state: {} }, { name: "dirt", state: {} })).toBe(false));
});
