import { Vec3 } from "vec3";
import type { BlockReader } from "../blueprint/verify.js";

type ReadableBot = {
  blockAt(v: Vec3): { name: string; getProperties(): Record<string, unknown> } | null;
};

/** Adapts a Mineflayer bot to a BlockReader; property values are stringified. Returns null for unloaded chunks. */
export function makeBlockReader(bot: ReadableBot): BlockReader {
  return ([x, y, z]) => {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return null;
    const state: Record<string, string> = {};
    for (const [k, v] of Object.entries(block.getProperties())) state[k] = String(v);
    return { name: block.name, state };
  };
}
