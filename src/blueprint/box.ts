import type { Vec3Tuple } from "../types.js";

export function normalizeBox(a: Vec3Tuple, b: Vec3Tuple): [Vec3Tuple, Vec3Tuple] {
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  ];
}

export function boxVolume(min: Vec3Tuple, max: Vec3Tuple): number {
  return (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
}

export function splitBox(min: Vec3Tuple, max: Vec3Tuple, maxVolume: number): [Vec3Tuple, Vec3Tuple][] {
  if (boxVolume(min, max) <= maxVolume) return [[min, max]];
  const sizes = [0, 1, 2].map((i) => max[i] - min[i] + 1);
  const axis = sizes.indexOf(Math.max(...sizes));
  if (sizes[axis] < 2) return [[min, max]];
  const mid = min[axis] + Math.floor(sizes[axis] / 2);
  const aMax: Vec3Tuple = [...max];
  aMax[axis] = mid - 1;
  const bMin: Vec3Tuple = [...min];
  bMin[axis] = mid;
  return [...splitBox(min, aMax, maxVolume), ...splitBox(bMin, max, maxVolume)];
}
