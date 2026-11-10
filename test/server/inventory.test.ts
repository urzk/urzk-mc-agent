import { describe, expect, test, vi } from "vitest";
import type { Bot } from "mineflayer";
import { giveItem } from "../../src/bot/inventory.js";
import { UserFacingError } from "../../src/errors.js";

function fakeInventoryBot(opts: { quickBarSlot?: number; creativeFails?: boolean }) {
  const sent: string[] = [];
  const listeners: ((m: string, p: string) => void)[] = [];
  const set: { slot: number; type: number; count: number }[] = [];
  const bot = {
    version: "1.20.4",
    quickBarSlot: opts.quickBarSlot ?? 0,
    registry: { itemsByName: { stone: { id: 1 } } },
    creative: {
      setInventorySlot: async (slot: number, item: { type: number; count: number }) => {
        if (opts.creativeFails) throw new Error("not creative");
        set.push({ slot, type: item.type, count: item.count });
      },
    },
    username: "Builder",
    chat: (m: string) => {
      sent.push(m);
      for (const l of listeners) l("Unknown command", "system");
    },
    on: (_: string, fn: (m: string, p: string) => void) => (listeners.push(fn), bot),
    off: () => bot,
    sent,
    set,
  };
  return bot as unknown as Bot & { sent: string[]; set: typeof set };
}

describe("giveItem", () => {
  test("uses creative slot of selected hotbar", async () => {
    const bot = fakeInventoryBot({ quickBarSlot: 2 });
    expect(await giveItem(bot, "stone", 64)).toEqual({ method: "creative", slot: 38 });
    expect(bot.set).toEqual([{ slot: 38, type: 1, count: 64 }]);
  });
  test("explicit slot", async () => {
    expect(await giveItem(fakeInventoryBot({}), "stone", 1, 40)).toEqual({ method: "creative", slot: 40 });
  });
  test("falls back to /give", async () => {
    const bot = fakeInventoryBot({ creativeFails: true });
    vi.useFakeTimers();
    const p = giveItem(bot, "stone", 1);
    await vi.advanceTimersByTimeAsync(300);
    expect(await p).toEqual({ method: "command", messages: ["Unknown command"] });
    expect(bot.sent).toContain("/give Builder stone 1");
    vi.useRealTimers();
  });
  test("unknown item", async () => {
    await expect(giveItem(fakeInventoryBot({}), "nope", 1)).rejects.toThrow(UserFacingError);
  });
});
