import { EventEmitter } from "node:events";
import { beforeEach, expect, test, vi } from "vitest";

const created: { opts: Record<string, unknown>; bot: EventEmitter & { end: ReturnType<typeof vi.fn>; loadPlugin: () => void } }[] = [];
vi.mock("mineflayer", () => ({
  default: {
    createBot: (opts: Record<string, unknown>) => {
      const bot = Object.assign(new EventEmitter(), { end: vi.fn(), loadPlugin: () => {} });
      created.push({ opts, bot });
      return bot;
    },
  },
}));

import { BotManager } from "../../src/bot/manager.js";
import { loadConfig } from "../../src/config.js";
import { UserFacingError } from "../../src/errors.js";
import { msaCacheDir } from "../../src/paths.js";

beforeEach(() => {
  created.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("token cache is package-relative", () => {
  void new BotManager(loadConfig({})).connect({}).catch(() => {});
  expect(created[0].opts.profilesFolder).toBe(msaCacheDir);
});

test("error event rejects with UserFacingError and ends the bot once (re-entrancy safe)", async () => {
  const m = new BotManager(loadConfig({}));
  const p = m.connect({});
  const { bot } = created[0];
  bot.end.mockImplementation(() => bot.emit("end", "closed"));
  bot.emit("error", new Error("protocol"));
  await expect(p).rejects.toBeInstanceOf(UserFacingError);
  expect(bot.end).toHaveBeenCalledTimes(1);
  expect(m.status().lastDisconnectReason).toBe("error: protocol");
});

test("kick rejects with UserFacingError", async () => {
  const m = new BotManager(loadConfig({}));
  const p = m.connect({});
  created[0].bot.emit("kicked", "bye");
  await expect(p).rejects.toBeInstanceOf(UserFacingError);
});

test("spawn timeout rejects with UserFacingError", async () => {
  vi.useFakeTimers();
  try {
    const m = new BotManager(loadConfig({}));
    const p = m.connect({});
    const a = expect(p).rejects.toBeInstanceOf(UserFacingError);
    await vi.advanceTimersByTimeAsync(60_000);
    await a;
  } finally {
    vi.useRealTimers();
  }
});
