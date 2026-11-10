import { normalizeCommand } from "../commands/collector.js";
import { UserFacingError } from "../errors.js";
import type { Vec3Tuple } from "../types.js";

const TELEPORT_TIMEOUT_MS = 5000;

type TeleportBot = {
  entity: { position: { x: number; y: number; z: number } };
  chat(msg: string): void;
  on(ev: "messagestr", fn: (msg: string, position: string) => void): unknown;
  off(ev: "messagestr", fn: (msg: string, position: string) => void): unknown;
  once(ev: "forcedMove", fn: () => void): unknown;
  removeListener(ev: "forcedMove", fn: () => void): unknown;
  waitForChunksToLoad(): Promise<void>;
};

/**
 * Teleports the bot (needs op), waits for the server's position correction (forcedMove) so the
 * chunks around the destination - not the old position - are the ones awaited, then waits for them.
 */
export async function teleportBot(bot: TeleportBot, pos: Vec3Tuple): Promise<void> {
  const p = bot.entity.position;
  const near = Math.hypot(p.x - pos[0], p.y - pos[1], p.z - pos[2]) <= 1;
  if (!near) {
    const messages: string[] = [];
    const onMsg = (msg: string, position: string) => {
      if (position !== "game_info") messages.push(msg);
    };
    let onMove: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const moved = new Promise<boolean>((resolve) => {
      onMove = () => resolve(true);
      timer = setTimeout(() => resolve(false), TELEPORT_TIMEOUT_MS);
    });
    bot.once("forcedMove", onMove);
    bot.on("messagestr", onMsg);
    let ok: boolean;
    try {
      bot.chat(normalizeCommand(`/tp @s ${pos.join(" ")}`));
      ok = await moved;
    } finally {
      clearTimeout(timer);
      bot.removeListener("forcedMove", onMove);
      bot.off("messagestr", onMsg);
    }
    if (!ok) {
      throw new UserFacingError(
        `テレポートを確認できませんでした (${pos.join(" ")})。権限を確認してください。` +
          (messages.length ? ` サーバー応答: ${messages.join(" / ")}` : ""),
      );
    }
  }
  await bot.waitForChunksToLoad();
}
