export type Vec3Tuple = [number, number, number];

export type BlockSpec = { name: string; state: Record<string, string> };

export function posKey(p: Vec3Tuple): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

export function parsePosKey(k: string): Vec3Tuple {
  const parts = k.split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`invalid position key: ${k}`);
  }
  return [parts[0], parts[1], parts[2]];
}
