import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { UserFacingError } from "../../src/errors.js";
import { normalizeCommand, runCommand, runCommands, type ChatBot } from "../../src/commands/collector.js";

class FakeBot extends EventEmitter {
  sent: string[] = [];
  chat(msg: string): void {
    this.sent.push(msg);
  }
}
const fakeBot = () => new FakeBot();

// 型レベル検査: mineflayer の Bot は ChatBot を満たす
const _botSatisfiesChatBot = (b: Bot): ChatBot => b;
void _botSatisfiesChatBot;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("normalize", () => {
  expect(normalizeCommand(" fill 0 0 0 1 1 1 stone")).toBe("/fill 0 0 0 1 1 1 stone");
  expect(normalizeCommand("//set glass")).toBe("//set glass");
});

test("collects messages within window", async () => {
  const bot = fakeBot();
  const p = runCommand(bot, "//set stone", 1000);
  bot.emit("messagestr", "Operation completed (27 blocks affected).", "system");
  bot.emit("messagestr", "hotbar text", "game_info");
  await vi.advanceTimersByTimeAsync(1000);
  bot.emit("messagestr", "late", "system");
  expect(await p).toEqual({ command: "//set stone", messages: ["Operation completed (27 blocks affected)."] });
  expect(bot.sent).toEqual(["//set stone"]);
  expect(bot.listenerCount("messagestr")).toBe(0);
});

test("runCommands sends in order with delay", async () => {
  const bot = fakeBot();
  const p = runCommands(bot, ["setblock 0 0 0 stone", "/setblock 1 0 0 stone"], { delayMs: 50, collectMs: 100 });
  await vi.advanceTimersByTimeAsync(200);
  expect(await p).toEqual({ sent: 2, messages: [] });
  expect(bot.sent).toEqual(["/setblock 0 0 0 stone", "/setblock 1 0 0 stone"]);
});

test("runCommands collects across sequence and detaches on error", async () => {
  const bot = fakeBot();
  const p = runCommands(bot, ["a", "b"], { delayMs: 50, collectMs: 100 });
  bot.emit("messagestr", "m1", "system");
  await vi.advanceTimersByTimeAsync(50);
  bot.emit("messagestr", "m2", "system");
  await vi.advanceTimersByTimeAsync(100);
  expect((await p).messages).toEqual(["m1", "m2"]);
  expect(bot.listenerCount("messagestr")).toBe(0);

  const bad = fakeBot();
  bad.chat = () => {
    throw new Error("boom");
  };
  await expect(runCommands(bad, ["x"])).rejects.toThrow("boom");
  expect(bad.listenerCount("messagestr")).toBe(0);
});

test("rejects commands longer than 256 chars", async () => {
  const long = "/say " + "a".repeat(252);
  expect(() => normalizeCommand(long)).toThrow(UserFacingError);
  const bot = fakeBot();
  await expect(runCommand(bot, long)).rejects.toBeInstanceOf(UserFacingError);
  await expect(runCommands(bot, ["/ok", long])).rejects.toBeInstanceOf(UserFacingError);
  expect(bot.sent).toEqual([]);
  expect(normalizeCommand("/" + "a".repeat(255))).toHaveLength(256);
});
