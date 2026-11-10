import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { activateAndWait } from "../../src/bot/interact.js";

function blockAt(x: number, y: number, z: number, open: boolean) {
  return { position: { x, y, z }, name: "oak_door", getProperties: () => ({ open }) };
}

function makeBot() {
  let current = blockAt(1, 2, 3, false);
  const bot = Object.assign(new EventEmitter(), {
    activateBlock: vi.fn(async () => {}),
    blockAt: vi.fn(() => current),
  });
  return { bot, set: (b: ReturnType<typeof blockAt>) => (current = b) };
}

afterEach(() => vi.useRealTimers());

describe("activateAndWait", () => {
  test("returns the block after the server update for that position", async () => {
    const { bot, set } = makeBot();
    bot.activateBlock.mockImplementation(async () => {
      setTimeout(() => {
        bot.emit("blockUpdate", null, blockAt(9, 9, 9, true)); // other position: ignored
        const opened = blockAt(1, 2, 3, true);
        set(opened);
        bot.emit("blockUpdate", null, opened);
      }, 5);
    });
    const r = await activateAndWait(bot as never, blockAt(1, 2, 3, false) as never, 1000);
    expect(r.updated).toBe(true);
    expect(r.block.getProperties()).toEqual({ open: true });
    expect(bot.listenerCount("blockUpdate")).toBe(0);
  });

  test("times out with updated=false when nothing changes", async () => {
    vi.useFakeTimers();
    const { bot } = makeBot();
    const p = activateAndWait(bot as never, blockAt(1, 2, 3, false) as never, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.updated).toBe(false);
    expect(bot.listenerCount("blockUpdate")).toBe(0);
  });

  test("detaches the listener when activateBlock throws", async () => {
    const { bot } = makeBot();
    bot.activateBlock.mockRejectedValue(new Error("boom"));
    await expect(activateAndWait(bot as never, blockAt(1, 2, 3, false) as never)).rejects.toThrow("boom");
    expect(bot.listenerCount("blockUpdate")).toBe(0);
  });
});
