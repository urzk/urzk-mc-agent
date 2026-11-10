import { describe, expect, test } from "vitest";
import type { Bot } from "mineflayer";
import { giveItem } from "../../src/bot/inventory.js";
import { UserFacingError } from "../../src/errors.js";

function fakeInventoryBot(opts: { quickBarSlot?: number; creativeFails?: boolean }) {
  const sent: string[] = [];
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
    chat: (m: string) => void sent.push(m),
    on: () => bot,
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
    expect((await giveItem(bot, "stone", 1)).method).toBe("command");
    expect(bot.sent).toContain("/give @s stone 1");
  });
  test("unknown item", async () => {
    await expect(giveItem(fakeInventoryBot({}), "nope", 1)).rejects.toThrow(UserFacingError);
  });
});
