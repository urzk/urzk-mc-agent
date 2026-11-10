import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadBlueprint } from "../../src/blueprint/load.js";
import { BlueprintSchema } from "../../src/blueprint/schema.js";

const write = async (name: string, text: string) => {
  const dir = await mkdtemp(join(tmpdir(), "bp-"));
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
};

describe("loadBlueprint", () => {
  test("returns the inline blueprint", async () => {
    const bp = BlueprintSchema.parse({ ops: [] });
    expect(await loadBlueprint({ blueprint: bp })).toBe(bp);
  });
  test("reads and validates a file, applying defaults", async () => {
    const path = await write("a.json", JSON.stringify({ ops: [{ op: "set", at: [0, 0, 0], block: "stone" }] }));
    expect(await loadBlueprint({ blueprintPath: path })).toEqual({
      palette: {},
      ops: [{ op: "set", at: [0, 0, 0], block: "stone" }],
    });
  });
  test("rejects both or neither", async () => {
    await expect(loadBlueprint({})).rejects.toThrow(/どちらか/);
    await expect(loadBlueprint({ blueprint: BlueprintSchema.parse({ ops: [] }), blueprintPath: "/x.json" })).rejects.toThrow(
      /一方だけ/,
    );
  });
  test("rejects a relative path", async () => {
    await expect(loadBlueprint({ blueprintPath: "bp.json" })).rejects.toThrow(/絶対パス/);
  });
  test("reports a missing file, bad JSON and an invalid blueprint", async () => {
    await expect(loadBlueprint({ blueprintPath: "/nonexistent/bp.json" })).rejects.toThrow(/読めません/);
    await expect(loadBlueprint({ blueprintPath: await write("b.json", "{") })).rejects.toThrow(/JSON ではありません/);
    await expect(loadBlueprint({ blueprintPath: await write("c.json", '{"ops":[{"op":"boom"}]}') })).rejects.toThrow(
      /形式が不正/,
    );
  });
});
