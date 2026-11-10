import type { Vec3Tuple } from "../types.js";
import { compileBlueprint } from "./compile.js";
import type { Blueprint } from "./schema.js";
import { blueprintBounds } from "./verify.js";

export type ApplyDeps = {
  teleport(pos: Vec3Tuple): Promise<void>;
  run(commands: string[]): Promise<{ sent: number; messages: string[] }>;
};

export function blueprintCenter(bp: Blueprint, origin: Vec3Tuple): Vec3Tuple | null {
  const b = blueprintBounds(bp, origin);
  if (!b) return null;
  return [0, 1, 2].map((i) => Math.floor((b.min[i] + b.max[i]) / 2)) as Vec3Tuple;
}

export async function applyBlueprint(
  deps: ApplyDeps,
  bp: Blueprint,
  origin: Vec3Tuple,
  opts: { dryRun?: boolean; maxCommands?: number; selfName?: string } = {},
): Promise<{ commands: string[]; sent: number; messages: string[] }> {
  const commands = compileBlueprint(bp, origin, { maxCommands: opts.maxCommands, selfName: opts.selfName });
  const center = blueprintCenter(bp, origin);
  if (opts.dryRun || commands.length === 0 || !center) return { commands, sent: 0, messages: [] };
  await deps.teleport(center);
  const { sent, messages } = await deps.run(commands);
  return { commands, sent, messages };
}
