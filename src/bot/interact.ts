import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";

export interface ActivateResult {
  block: Block;
  /** true if the server sent an update for this position before the timeout. */
  updated: boolean;
}

/**
 * Right-click a block and wait until the server reports a change at that position
 * (doors, levers, trapdoors...). Blocks that do not change (chests, crafting tables)
 * resolve after `timeoutMs` with updated=false. Returns the latest block.
 */
export async function activateAndWait(bot: Bot, block: Block, timeoutMs = 1000): Promise<ActivateResult> {
  const pos = block.position;
  let onUpdate: ((oldBlock: Block | null, newBlock: Block) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = new Promise<boolean>((resolve) => {
    onUpdate = (_old, nb) => {
      if (nb && nb.position.x === pos.x && nb.position.y === pos.y && nb.position.z === pos.z) resolve(true);
    };
    timer = setTimeout(() => resolve(false), timeoutMs);
    bot.on("blockUpdate", onUpdate);
  });
  try {
    await bot.activateBlock(block);
    const updated = await changed;
    return { block: bot.blockAt(pos) ?? block, updated };
  } finally {
    if (timer) clearTimeout(timer);
    if (onUpdate) bot.off("blockUpdate", onUpdate);
  }
}
