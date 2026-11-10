import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Block state id in the server's version -> block state id in the viewer's (older) version. */
export type StateRemap = (stateId: number) => number;

const cache = new Map<string, StateRemap | null>();

/**
 * Builds a state-id translation from `from` to `to` by matching block name and properties.
 * Blocks that do not exist in `to` become air; properties unknown to `to` are dropped.
 * Returns null when no translation is needed (same block registry).
 */
export function createStateRemap(from: string, to: string): StateRemap | null {
  const key = `${from}->${to}`;
  if (cache.has(key)) return cache.get(key)!;
  const remap = buildRemap(from, to);
  cache.set(key, remap);
  return remap;
}

function buildRemap(from: string, to: string): StateRemap | null {
  if (from === to) return null;
  const mcData = require("minecraft-data");
  const src = mcData(from);
  const dst = mcData(to);
  const SrcBlock = require("prismarine-block")(from);
  const DstBlock = require("prismarine-block")(to);
  let max = 0;
  for (const b of src.blocksArray) max = Math.max(max, b.maxStateId);
  const table = new Int32Array(max + 1);
  let identical = true;
  const air = dst.blocksByName.air.defaultState as number;
  for (let id = 0; id <= max; id++) {
    const b = SrcBlock.fromStateId(id, 0);
    const target = dst.blocksByName[b.name];
    let out = air;
    if (target) {
      const known = new Set((target.states ?? []).map((s: { name: string }) => s.name));
      const props = Object.fromEntries(Object.entries(b.getProperties()).filter(([k]) => known.has(k)));
      out = DstBlock.fromProperties(b.name, props, 0).stateId ?? target.defaultState;
    }
    table[id] = out;
    if (out !== id) identical = false;
  }
  if (identical) return null;
  return (id) => (id >= 0 && id < table.length ? table[id] : air);
}

type Json = Record<string, unknown>;

/** Rewrites the block states of a prismarine-chunk (1.18+) column JSON string. */
export function remapColumnJson(columnJson: string, remap: StateRemap): string {
  const column = JSON.parse(columnJson) as Json & { sections: string[] };
  column.sections = column.sections.map((sectionJson) => {
    const section = JSON.parse(sectionJson) as Json & { data: string };
    section.data = remapContainerJson(section.data, remap);
    return JSON.stringify(section);
  });
  return JSON.stringify(column);
}

function remapContainerJson(containerJson: string, remap: StateRemap): string {
  const c = JSON.parse(containerJson) as Json;
  if (c.type === "single") {
    c.value = remap(c.value as number);
  } else if (c.type === "indirect") {
    c.palette = (c.palette as number[]).map(remap);
  } else if (c.type === "direct") {
    const BitArray = require("prismarine-chunk/src/pc/common/BitArrayNoSpan.js");
    const bits = BitArray.fromJson(c.data as string);
    for (let i = 0; i < bits.capacity; i++) bits.set(i, remap(bits.get(i)));
    c.data = bits.toJson();
  }
  return JSON.stringify(c);
}
