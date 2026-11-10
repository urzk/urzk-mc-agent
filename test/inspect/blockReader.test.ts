import { describe, expect, test } from "vitest";
import { makeBlockReader } from "../../src/inspect/blockReader.js";

describe("makeBlockReader", () => {
  test("stringifies props", () => {
    const read = makeBlockReader({
      blockAt: () => ({ name: "lever", getProperties: () => ({ powered: true, face: "wall" }) }),
    });
    expect(read([0, 0, 0])).toEqual({ name: "lever", state: { powered: "true", face: "wall" } });
  });
  test("null when unloaded", () => {
    expect(makeBlockReader({ blockAt: () => null })([0, 0, 0])).toBeNull();
  });
});
