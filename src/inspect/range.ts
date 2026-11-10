import { boxVolume, normalizeBox } from "../blueprint/box.js";
import { UserFacingError } from "../errors.js";
import type { Vec3Tuple } from "../types.js";

export function assertReadableRange(from: Vec3Tuple, to: Vec3Tuple, maxVolume = 32768): [Vec3Tuple, Vec3Tuple] {
  const [min, max] = normalizeBox(from, to);
  const volume = boxVolume(min, max);
  if (volume > maxVolume) {
    throw new UserFacingError(`読み取り範囲が大きすぎます（${volume} ブロック、上限 ${maxVolume}）。範囲を狭めてください。`);
  }
  return [min, max];
}
