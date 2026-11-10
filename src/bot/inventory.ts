import type { Bot } from "mineflayer";
import itemModule, { type Item } from "prismarine-item";
import { runCommand } from "../commands/collector.js";
import { UserFacingError } from "../errors.js";

// prismarine-item is CJS (module.exports = loader); NodeNext types the default import as the module namespace.
const loadItem = itemModule as unknown as (version: string) => typeof Item;

const GIVE_COLLECT_MS = 300;

/**
 * Puts `count` of `item` into the inventory. Tries creative-mode slot setting first
 * (default slot = selected hotbar slot), then falls back to `/give <bot name>` (the returned chat messages show e.g. a permission denial).
 */
export async function giveItem(
  bot: Bot,
  item: string,
  count: number,
  slot?: number,
): Promise<{ method: "creative"; slot: number } | { method: "command"; messages: string[] }> {
  const info = bot.registry.itemsByName[item];
  if (!info) throw new UserFacingError(`不明なアイテム名です: ${item}`);
  const targetSlot = slot ?? 36 + bot.quickBarSlot;
  try {
    const ItemClass = loadItem(bot.version);
    await bot.creative.setInventorySlot(targetSlot, new ItemClass(info.id, count));
    return { method: "creative", slot: targetSlot };
  } catch (e) {
    console.error("creative setInventorySlot failed, falling back to /give:", e);
    const { messages } = await runCommand(bot, `/give ${bot.username} ${item} ${count}`, GIVE_COLLECT_MS);
    return { method: "command", messages };
  }
}
