import { formatBlockSpec } from "../blueprint/blockSpec.js";
import { normalizeBox } from "../blueprint/box.js";
import type { BlockReader } from "../blueprint/verify.js";
import { NotLoadedError, UserFacingError } from "../errors.js";
import type { BlockSpec, Vec3Tuple } from "../types.js";

const SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function readLoaded(pos: Vec3Tuple, readBlock: BlockReader): BlockSpec {
  const b = readBlock(pos);
  if (b === null) throw new NotLoadedError(pos);
  return b;
}

export function renderLayers(
  from: Vec3Tuple,
  to: Vec3Tuple,
  readBlock: BlockReader,
): { legend: Record<string, string>; layers: { y: number; rows: string[] }[] } {
  const [min, max] = normalizeBox(from, to);
  const legend: Record<string, string> = {};
  const symbolOf = new Map<string, string>();
  const layers: { y: number; rows: string[] }[] = [];
  for (let y = min[1]; y <= max[1]; y++) {
    const rows: string[] = [];
    for (let z = min[2]; z <= max[2]; z++) {
      let row = "";
      for (let x = min[0]; x <= max[0]; x++) {
        const b = readLoaded([x, y, z], readBlock);
        const text = formatBlockSpec(b);
        let sym = b.name === "air" ? "." : symbolOf.get(text);
        if (sym === undefined) {
          if (symbolOf.size >= SYMBOLS.length) {
            throw new UserFacingError(
              `ブロックの種類が ${SYMBOLS.length} を超えました。範囲を狭めるか list 形式を使ってください。`,
            );
          }
          sym = SYMBOLS[symbolOf.size];
          symbolOf.set(text, sym);
        }
        legend[sym] = text;
        row += sym;
      }
      rows.push(row);
    }
    layers.push({ y, rows });
  }
  return { legend, layers };
}

export function listBlocks(
  from: Vec3Tuple,
  to: Vec3Tuple,
  readBlock: BlockReader,
): { airCount: number; blocks: { pos: Vec3Tuple; block: string }[] } {
  const [min, max] = normalizeBox(from, to);
  let airCount = 0;
  const blocks: { pos: Vec3Tuple; block: string }[] = [];
  for (let y = min[1]; y <= max[1]; y++) {
    for (let z = min[2]; z <= max[2]; z++) {
      for (let x = min[0]; x <= max[0]; x++) {
        const b = readLoaded([x, y, z], readBlock);
        if (b.name === "air") airCount++;
        else blocks.push({ pos: [x, y, z], block: formatBlockSpec(b) });
      }
    }
  }
  return { airCount, blocks };
}
