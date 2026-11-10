import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { z } from "zod";
import { giveItem } from "../../bot/inventory.js";
import { NotLoadedError, UserFacingError } from "../../errors.js";
import type { ToolContext } from "../createServer.js";
import { jsonResult, safe } from "../result.js";

function itemInfo(bot: Bot, name: string) {
  const info = bot.registry.itemsByName[name];
  if (!info) throw new UserFacingError(`不明なアイテム名です: ${name}`);
  return info;
}

async function openChestAt(bot: Bot, x: number, y: number, z: number) {
  const block = bot.blockAt(new Vec3(x, y, z));
  if (!block) throw new NotLoadedError([x, y, z]);
  try {
    return await bot.openContainer(block);
  } catch (e) {
    throw new UserFacingError(`コンテナを開けません (${block.name} at ${x},${y},${z}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

const Pos = { x: z.number().int(), y: z.number().int(), z: z.number().int() };

export function registerInventoryTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_inventory",
    { description: "List inventory items as { slot, name, count } plus the selected hotbar slot (0-8)." },
    safe(async () => {
      const bot = ctx.bots.bot;
      const items = bot.inventory.items().map((i) => ({ slot: i.slot, name: i.name, count: i.count }));
      return jsonResult({ items, selectedHotbarSlot: bot.quickBarSlot });
    }),
  );

  server.registerTool(
    "set_hotbar_slot",
    { description: "Select a hotbar slot (0-8).", inputSchema: { slot: z.number().int().min(0).max(8) } },
    safe(async ({ slot }) => {
      ctx.bots.bot.setQuickBarSlot(slot);
      return jsonResult({ selectedHotbarSlot: slot });
    }),
  );

  server.registerTool(
    "give_item",
    {
      description:
        "Get an item (creative inventory, falling back to /give <bot name>; the fallback returns the server chat messages). Goes to the selected hotbar slot unless slot (inventory slot index, hotbar = 36-44) is given.",
      inputSchema: { item: z.string().min(1), count: z.number().int().min(1).max(64).default(1), slot: z.number().int().min(0).max(45).optional() },
    },
    safe(async ({ item, count, slot }) => jsonResult(await giveItem(ctx.bots.bot, item, count, slot))),
  );

  server.registerTool(
    "equip",
    {
      description: "Equip an inventory item into hand, off-hand or an armor slot.",
      inputSchema: {
        item: z.string().min(1),
        destination: z.enum(["hand", "off-hand", "head", "torso", "legs", "feet"]),
      },
    },
    safe(async ({ item, destination }) => {
      const bot = ctx.bots.bot;
      const found = bot.inventory.items().find((i) => i.name === item);
      if (!found) throw new UserFacingError(`インベントリに ${item} がありません`);
      await bot.equip(found, destination);
      return jsonResult({ equipped: item, destination });
    }),
  );

  server.registerTool(
    "drop",
    {
      description: "Drop an item from the inventory. count omitted drops all of that item.",
      inputSchema: { item: z.string().min(1), count: z.number().int().min(1).optional() },
    },
    safe(async ({ item, count }) => {
      const bot = ctx.bots.bot;
      const info = itemInfo(bot, item);
      const have = bot.inventory.count(info.id, null);
      if (have === 0) throw new UserFacingError(`インベントリに ${item} がありません`);
      const n = Math.min(count ?? have, have);
      await bot.toss(info.id, null, n);
      return jsonResult({ dropped: item, count: n });
    }),
  );

  server.registerTool(
    "open_container",
    {
      description: "Open the container (chest, barrel, ...) at a position, return its contents, and close it.",
      inputSchema: Pos,
    },
    safe(async ({ x, y, z: zc }) => {
      const container = await openChestAt(ctx.bots.bot, x, y, zc);
      try {
        const items = container.containerItems().map((i) => ({ slot: i.slot, name: i.name, count: i.count }));
        return jsonResult({ items });
      } finally {
        await container.close();
      }
    }),
  );

  server.registerTool(
    "container_transfer",
    {
      description: "Move items between the inventory and the container at a position (deposit = inventory to container, withdraw = container to inventory).",
      inputSchema: {
        ...Pos,
        direction: z.enum(["deposit", "withdraw"]),
        item: z.string().min(1),
        count: z.number().int().min(1),
      },
    },
    safe(async ({ x, y, z: zc, direction, item, count }) => {
      const bot = ctx.bots.bot;
      const info = itemInfo(bot, item);
      const container = await openChestAt(bot, x, y, zc);
      try {
        if (direction === "deposit") await container.deposit(info.id, null, count);
        else await container.withdraw(info.id, null, count);
        return jsonResult({ direction, item, count });
      } finally {
        await container.close();
      }
    }),
  );
}
