import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { createStateRemap, remapColumnJson } from "../../src/inspect/stateRemap.js";

const require = createRequire(import.meta.url);
const mcData = require("minecraft-data");
const v8 = mcData("1.21.8");
const v4 = mcData("1.21.4");

describe("createStateRemap", () => {
  const remap = createStateRemap("1.21.8", "1.21.4")!;
  test("maps by block name across shifted ids", () => {
    const from = v8.blocksByName.smooth_quartz.defaultState;
    const to = v4.blocksByName.smooth_quartz.defaultState;
    expect(from).not.toBe(to);
    expect(remap(from)).toBe(to);
    expect(remap(0)).toBe(0);
  });
  test("keeps block properties", () => {
    const B8 = require("prismarine-block")("1.21.8");
    const B4 = require("prismarine-block")("1.21.4");
    const s = B8.fromProperties("oak_stairs", { facing: "south", half: "top", shape: "straight", waterlogged: false }, 0);
    const out = B4.fromStateId(remap(s.stateId), 0);
    expect(out.name).toBe("oak_stairs");
    expect(out.getProperties()).toMatchObject({ facing: "south", half: "top" });
  });
  test("same version needs no remap", () => {
    expect(createStateRemap("1.21.4", "1.21.4")).toBeNull();
  });
});

describe("remapColumnJson", () => {
  test("rewrites a real chunk column so it reads back as the same blocks", () => {
    const Chunk8 = require("prismarine-chunk")("1.21.8");
    const Chunk4 = require("prismarine-chunk")("1.21.4");
    const col = new Chunk8({ minY: -64, worldHeight: 384 });
    const quartz8 = v8.blocksByName.smooth_quartz.defaultState;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) col.setBlockStateId({ x, y: 55, z }, quartz8);
    col.setBlockStateId({ x: 0, y: 70, z: 0 }, quartz8); // single-block section (indirect palette)
    const out = Chunk4.fromJson(remapColumnJson(col.toJson(), createStateRemap("1.21.8", "1.21.4")!));
    expect(out.getBlock({ x: 3, y: 55, z: 7 }).name).toBe("smooth_quartz");
    expect(out.getBlock({ x: 0, y: 70, z: 0 }).name).toBe("smooth_quartz");
    expect(out.getBlock({ x: 1, y: 70, z: 0 }).name).toBe("air");
  });
});
