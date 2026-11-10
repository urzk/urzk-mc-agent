import type { Vec3Tuple } from "../types.js";

// Order matters: below, above, north (-z), south (+z), west (-x), east (+x).
const NEIGHBOR_OFFSETS: Vec3Tuple[] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];

/** Picks the first solid neighbor of `target` to place against; `face` points from the reference toward the target. */
export function chooseReferenceFace(
  target: Vec3Tuple,
  isSolid: (pos: Vec3Tuple) => boolean,
): { reference: Vec3Tuple; face: Vec3Tuple } | null {
  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
    const reference: Vec3Tuple = [target[0] + dx, target[1] + dy, target[2] + dz];
    if (isSolid(reference)) return { reference, face: [-dx + 0, -dy + 0, -dz + 0] };
  }
  return null;
}
