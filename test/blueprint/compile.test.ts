import { describe, expect, test } from "vitest";
import { compileBlueprint } from "../../src/blueprint/compile.js";
import { BlueprintSchema } from "../../src/blueprint/schema.js";
import { BlueprintError } from "../../src/errors.js";

const P = (o: unknown) => BlueprintSchema.parse(o);

describe("compileBlueprint", () => {
  test("fill absolute with negative origin", () => expect(compileBlueprint(
    P({ ops: [{ op: "fill", from: [0, 0, 0], to: [2, 1, 2], block: "stone" }] }), [-100, 64, -200]))
    .toEqual(["/fill -100 64 -200 -98 65 -198 stone"]));
  test("reversed from/to normalized", () => expect(compileBlueprint(
    P({ ops: [{ op: "fill", from: [2, 1, 2], to: [0, 0, 0], block: "stone" }] }), [0, 0, 0]))
    .toEqual(["/fill 0 0 0 2 1 2 stone"]));
  test("large fill split", () => {
    const cmds = compileBlueprint(P({ ops: [{ op: "fill", from: [0, 0, 0], to: [99, 9, 99], block: "stone" }] }), [0, 0, 0]);
    expect(cmds.length).toBeGreaterThan(1);
    expect(cmds.every(c => c.startsWith("/fill "))).toBe(true);
  });
  test("hollow small", () => expect(compileBlueprint(
    P({ ops: [{ op: "hollow", from: [0, 0, 0], to: [4, 4, 4], block: "oak_planks" }] }), [0, 0, 0]))
    .toEqual(["/fill 0 0 0 4 4 4 oak_planks hollow"]));
  test("hollow large: shell faces then air interior", () => {
    const cmds = compileBlueprint(P({ ops: [{ op: "hollow", from: [0, 0, 0], to: [49, 29, 29], block: "stone" }] }), [0, 0, 0]);
    expect(cmds.some(c => c.endsWith(" hollow"))).toBe(false);
    const air = cmds.filter(c => c.endsWith(" air"));
    expect(air.length).toBeGreaterThan(1);
    expect(air.join()).toContain("/fill 1 1 1 ");
    expect(cmds.slice(-air.length)).toEqual(air);
    expect(cmds.filter(c => c.endsWith(" stone")).length).toBeGreaterThanOrEqual(6);
  });
  test("hollow large flat box has no air interior", () => {
    const cmds = compileBlueprint(P({ ops: [{ op: "hollow", from: [0, 0, 0], to: [199, 0, 199], block: "stone" }] }), [0, 0, 0]);
    expect(cmds.some(c => c.endsWith(" air"))).toBe(false);
    expect(cmds.length).toBeGreaterThan(0);
  });
  test("set with state via palette", () => expect(compileBlueprint(
    P({ palette: { D: "oak_door[facing=south,half=lower]" }, ops: [{ op: "set", at: [1, 2, 3], block: "D" }] }), [10, 0, 0]))
    .toEqual(["/setblock 11 2 3 oak_door[facing=south,half=lower]"]));
  test("layers merges runs", () => expect(compileBlueprint(
    P({ palette: { S: "stone", G: "glass" }, ops: [{ op: "layers", at: [0, 0, 0], rows: [["SSG S"]] }] }), [0, 0, 0]))
    .toEqual(["/fill 0 0 0 1 0 0 stone", "/setblock 2 0 0 glass", "/setblock 4 0 0 stone"]));
  test("we op with pos and pos1/pos2", () => expect(compileBlueprint(
    P({ ops: [{ op: "we", command: "//set glass", pos: [0, 5, 0], pos1: [0, 0, 0], pos2: [3, 3, 3] }] }), [10, 60, 10]))
    .toEqual(["/tp @s 10 65 10", "//pos1 10,60,10", "//pos2 13,63,13", "//set glass"]));
  test("we op with command only", () => expect(compileBlueprint(
    P({ ops: [{ op: "we", command: "//undo" }] }), [1, 2, 3])).toEqual(["//undo"]));
  test("command limit", () => expect(() => compileBlueprint(
    P({ ops: [{ op: "layers", at: [0, 0, 0], rows: [["S S S S S"]] }], palette: { S: "stone" } }), [0, 0, 0], { maxCommands: 3 }))
    .toThrow(BlueprintError));
  test("huge fill fails fast on command limit", () => expect(() => compileBlueprint(
    P({ ops: [{ op: "fill", from: [0, 0, 0], to: [9999, 255, 9999], block: "stone" }] }), [0, 0, 0]))
    .toThrow(BlueprintError));
});
