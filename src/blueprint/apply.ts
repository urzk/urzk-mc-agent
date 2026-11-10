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
): Promise<ApplyResult> {
  const commands = compileBlueprint(bp, origin, { maxCommands: opts.maxCommands, selfName: opts.selfName });
  const center = blueprintCenter(bp, origin);
  if (opts.dryRun || commands.length === 0 || !center) return { commands, sent: 0, messages: [] };
  await deps.teleport(center);
  const { sent, messages } = await deps.run(commands);
  return { commands, sent, messages };
}

export type ApplyResult = { commands: string[]; sent: number; messages: string[] };

export type ApplySummary = {
  commandCount: number;
  sent: number;
  successMessages: number;
  otherMessages: string[];
  otherMessagesTruncated: number;
};

/** Routine per-command feedback (English: mineflayer renders translations with en_US). */
const SUCCESS_PATTERNS = [/^Changed the block at /, /^Successfully filled \d+ block/, /^Teleported /];
const MAX_OTHER_MESSAGES = 50;

/**
 * A real run echoes one feedback line per command, which can be tens of KB; keep only counts and the
 * messages that are not routine success lines (errors etc). A dry run keeps the full command list.
 */
export function summarizeApplyResult(r: ApplyResult, dryRun: boolean): ApplyResult | ApplySummary {
  if (dryRun) return r;
  const other = r.messages.filter((m) => !SUCCESS_PATTERNS.some((p) => p.test(m)));
  return {
    commandCount: r.commands.length,
    sent: r.sent,
    successMessages: r.messages.length - other.length,
    otherMessages: other.slice(0, MAX_OTHER_MESSAGES),
    otherMessagesTruncated: Math.max(0, other.length - MAX_OTHER_MESSAGES),
  };
}
