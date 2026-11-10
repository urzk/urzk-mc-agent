import { NotLoadedError, UserFacingError } from "../errors.js";
import { parsePosKey, type BlockSpec, type Vec3Tuple } from "../types.js";
import { blockMatches, formatBlockSpec } from "./blockSpec.js";
import { boxVolume, normalizeBox } from "./box.js";
import { expandBlueprint } from "./expand.js";
import type { Blueprint } from "./schema.js";

export const MAX_VERIFY_VOXELS = 262144;
const DEFAULT_MAX_MISMATCHES = 50;

/** Returns the block at an absolute position, or null when its chunk is not loaded. */
export type BlockReader = (pos: Vec3Tuple) => BlockSpec | null;

export type VerifyResult = {
  checked: number;
  mismatches: { pos: Vec3Tuple; expected: string; actual: string }[];
  truncated: number;
  skippedOps: number[];
};

const abs = (o: Vec3Tuple, p: Vec3Tuple): Vec3Tuple => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];

// Upper bound of voxels the ops would write (overlaps counted twice), without expanding.
function opVolumeSum(bp: Blueprint): number {
  let sum = 0;
  for (const op of bp.ops) {
    switch (op.op) {
      case "fill":
      case "hollow":
        sum += boxVolume(...normalizeBox(op.from, op.to));
        break;
      case "set":
        sum += 1;
        break;
      case "layers":
        for (const layer of op.rows) for (const row of layer) sum += [...row].length;
        break;
    }
  }
  return sum;
}

export function verifyBlueprint(
  bp: Blueprint,
  origin: Vec3Tuple,
  readBlock: BlockReader,
  opts: { maxMismatches?: number } = {},
): VerifyResult {
  const maxMismatches = opts.maxMismatches ?? DEFAULT_MAX_MISMATCHES;
  const total = opVolumeSum(bp);
  if (total > MAX_VERIFY_VOXELS) {
    throw new UserFacingError(
      `照合対象が大きすぎます (${total} ブロック、上限 ${MAX_VERIFY_VOXELS})。設計図を小さな部分に分割して照合してください。`,
    );
  }
  const { voxels, skippedOps } = expandBlueprint(bp);
  const result: VerifyResult = { checked: 0, mismatches: [], truncated: 0, skippedOps };
  for (const [key, expected] of voxels) {
    const pos = abs(origin, parsePosKey(key));
    const actual = readBlock(pos);
    if (actual === null) throw new NotLoadedError(pos);
    result.checked++;
    if (blockMatches(expected, actual)) continue;
    if (result.mismatches.length < maxMismatches) {
      result.mismatches.push({ pos, expected: formatBlockSpec(expected), actual: formatBlockSpec(actual) });
    } else {
      result.truncated++;
    }
  }
  return result;
}

// Absolute bounds from op extents; does not expand the blueprint. Layers count palette characters only.
export function blueprintBounds(bp: Blueprint, origin: Vec3Tuple): { min: Vec3Tuple; max: Vec3Tuple } | null {
  let min: Vec3Tuple | null = null;
  let max: Vec3Tuple | null = null;
  const include = (p: Vec3Tuple) => {
    const a = abs(origin, p);
    if (!min || !max) {
      min = [...a];
      max = [...a];
      return;
    }
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], a[i]);
      max[i] = Math.max(max[i], a[i]);
    }
  };

  for (const op of bp.ops) {
    switch (op.op) {
      case "fill":
      case "hollow":
        include(op.from);
        include(op.to);
        break;
      case "set":
        include(op.at);
        break;
      case "layers": {
        const [ox, oy, oz] = op.at;
        op.rows.forEach((layer, y) =>
          layer.forEach((row, z) =>
            [...row].forEach((ch, x) => {
              if (Object.hasOwn(bp.palette, ch)) include([ox + x, oy + y, oz + z]);
            }),
          ),
        );
        break;
      }
      case "we":
        for (const p of [op.pos, op.pos1, op.pos2]) if (p) include(p);
        break;
    }
  }
  return min && max ? { min, max } : null;
}
