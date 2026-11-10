import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { teleportBot } from "../../src/bot/teleport.js";
import { UserFacingError } from "../../src/errors.js";

function makeBot(at: [number, number, number]) {
  const bot = Object.assign(new EventEmitter(), {
    username: "Builder",
    entity: { position: { x: at[0], y: at[1], z: at[2] } },
    chat: vi.fn(),
    waitForChunksToLoad: vi.fn(async () => {}),
  });
  return bot;
}

afterEach(() => vi.useRealTimers());

describe("teleportBot", () => {
  test("waits for forcedMove, then chunks", async () => {
    const bot = makeBot([0, 0, 0]);
    const order: string[] = [];
    bot.waitForChunksToLoad.mockImplementation(async () => {
      order.push("chunks");
    });
    bot.chat.mockImplementation(() => {
      expect(bot.listenerCount("forcedMove")).toBe(1);
      setTimeout(() => {
        order.push("moved");
        bot.emit("forcedMove");
      }, 5);
    });
    await teleportBot(bot, [10, 64, 10]);
    expect(bot.chat).toHaveBeenCalledWith("/tp Builder 10 64 10");
    expect(order).toEqual(["moved", "chunks"]);
    expect(bot.listenerCount("forcedMove")).toBe(0);
    expect(bot.listenerCount("messagestr")).toBe(0);
  });
  test("already near skips tp but still waits for chunks", async () => {
    const bot = makeBot([10.5, 64, 10]);
    await teleportBot(bot, [10, 64, 10]);
    expect(bot.chat).not.toHaveBeenCalled();
    expect(bot.waitForChunksToLoad).toHaveBeenCalledOnce();
  });
  test("timeout throws UserFacingError with chat reply and detaches", async () => {
    vi.useFakeTimers();
    const bot = makeBot([0, 0, 0]);
    bot.chat.mockImplementation(() => bot.emit("messagestr", "You do not have permission", "chat"));
    const p = teleportBot(bot, [10, 64, 10]);
    const assertion = expect(p).rejects.toThrow(/You do not have permission/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    await expect(p).rejects.toBeInstanceOf(UserFacingError);
    expect(bot.listenerCount("forcedMove")).toBe(0);
    expect(bot.listenerCount("messagestr")).toBe(0);
    expect(bot.waitForChunksToLoad).not.toHaveBeenCalled();
  });
});
