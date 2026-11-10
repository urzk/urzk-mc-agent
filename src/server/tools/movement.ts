import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { z } from "zod";
import { activateAndWait } from "../../bot/interact.js";
import { giveItem } from "../../bot/inventory.js";
import { chooseReferenceFace } from "../../bot/placement.js";
import { teleportBot } from "../../bot/teleport.js";
import { NotLoadedError, UserFacingError } from "../../errors.js";
import type { ToolContext } from "../createServer.js";
import { jsonResult, safe } from "../result.js";

const { Movements, goals } = pathfinderPkg;

const REACH = 4.5;
const Pos = { x: z.number().int(), y: z.number().int(), z: z.number().int() };

function posOf(bot: Bot): [number, number, number] {
  const p = bot.entity.position;
  return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100];
}

function assertInReach(bot: Bot, x: number, y: number, z: number): void {
  const p = bot.entity.position;
  const d = Math.hypot(p.x - (x + 0.5), p.y - (y + 0.5), p.z - (z + 0.5));
  if (d > REACH) {
    throw new UserFacingError(`対象が遠すぎます (距離 ${d.toFixed(1)} > ${REACH})。先に move_to か teleport で近づいてください。`);
  }
}

function blockOrThrow(bot: Bot, x: number, y: number, z: number) {
  const block = bot.blockAt(new Vec3(x, y, z));
  if (!block) throw new NotLoadedError([x, y, z]);
  return block;
}

async function moveTo(bot: Bot, x: number, y: number, z: number, timeoutMs: number): Promise<void> {
  const movements = new Movements(bot);
  movements.canDig = false;
  bot.pathfinder.setMovements(movements);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${timeoutMs}ms 以内に到達できませんでした`)), timeoutMs);
  });
  const fail = (reason: string) =>
    new UserFacingError(`移動できませんでした (${reason})。現在地: ${posOf(bot).join(", ")}`);
  try {
    await Promise.race([bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)), timeout]);
  } catch (e) {
    bot.pathfinder.stop();
    throw fail(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

export function registerMovementTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "move_to",
    {
      description: "Walk to within 1 block of a position using pathfinding (no digging). Fails with the current position on timeout or no path.",
      inputSchema: { ...Pos, timeoutMs: z.number().int().min(1).max(120000).default(30000) },
    },
    safe(async ({ x, y, z: zc, timeoutMs }) => {
      const bot = ctx.bots.bot;
      await moveTo(bot, x, y, zc, timeoutMs);
      return jsonResult({ position: posOf(bot) });
    }),
  );

  server.registerTool(
    "teleport",
    { description: "Teleport the bot with /tp (needs op) and wait for the destination chunks to load.", inputSchema: Pos },
    safe(async ({ x, y, z: zc }) => {
      const bot = ctx.bots.bot;
      await teleportBot(bot, [x, y, zc]);
      return jsonResult({ position: posOf(bot) });
    }),
  );

  server.registerTool(
    "look_at",
    { description: "Face the center of a block position.", inputSchema: Pos },
    safe(async ({ x, y, z: zc }) => {
      await ctx.bots.bot.lookAt(new Vec3(x + 0.5, y + 0.5, zc + 0.5));
      return jsonResult({ lookedAt: [x, y, zc] });
    }),
  );

  server.registerTool(
    "interact_block",
    {
      description: "Right-click (activate) a block such as a lever, button or door; waits up to 1s for the server to update it and returns { name, state, updated } (updated=false: the block did not change, e.g. a chest). Must be within 4.5 blocks.",
      inputSchema: Pos,
    },
    safe(async ({ x, y, z: zc }) => {
      const bot = ctx.bots.bot;
      const block = blockOrThrow(bot, x, y, zc);
      assertInReach(bot, x, y, zc);
      const { block: after, updated } = await activateAndWait(bot, block);
      const state: Record<string, string> = {};
      for (const [k, v] of Object.entries(after.getProperties())) state[k] = String(v);
      return jsonResult({ name: after.name, state, updated });
    }),
  );

  server.registerTool(
    "place_block",
    {
      description: "Place a block at a position: gets the item into the hand, then places it against an adjacent solid block. Must be within 4.5 blocks.",
      inputSchema: { ...Pos, block: z.string().min(1) },
    },
    safe(async ({ x, y, z: zc, block }) => {
      const bot = ctx.bots.bot;
      blockOrThrow(bot, x, y, zc);
      assertInReach(bot, x, y, zc);
      const choice = chooseReferenceFace([x, y, zc], ([rx, ry, rz]) => {
        const b = bot.blockAt(new Vec3(rx, ry, rz));
        return !!b && b.boundingBox === "block";
      });
      if (!choice) throw new UserFacingError(`${x},${y},${zc} の隣に固体ブロックがなく、設置できません。`);
      await giveItem(bot, block, 1);
      const [rx, ry, rz] = choice.reference;
      await bot.placeBlock(blockOrThrow(bot, rx, ry, rz), new Vec3(...choice.face));
      return jsonResult({ placed: block, at: [x, y, zc], reference: choice.reference });
    }),
  );

  server.registerTool(
    "dig_block",
    { description: "Break the block at a position. Must be within 4.5 blocks.", inputSchema: Pos },
    safe(async ({ x, y, z: zc }) => {
      const bot = ctx.bots.bot;
      const target = blockOrThrow(bot, x, y, zc);
      assertInReach(bot, x, y, zc);
      await bot.dig(target);
      return jsonResult({ dug: target.name, at: [x, y, zc] });
    }),
  );
}
