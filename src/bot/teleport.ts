import { runCommand } from "../commands/collector.js";
import type { Vec3Tuple } from "../types.js";

type TeleportBot = Parameters<typeof runCommand>[0] & { waitForChunksToLoad(): Promise<void> };

/** Teleports the bot (needs op) and waits until the chunks around the destination are loaded. */
export async function teleportBot(bot: TeleportBot, pos: Vec3Tuple): Promise<void> {
  await runCommand(bot, `/tp @s ${pos.join(" ")}`, 0);
  await bot.waitForChunksToLoad();
}
