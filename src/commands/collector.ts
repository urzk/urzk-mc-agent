import { UserFacingError } from "../errors.js";

export interface ChatBot {
  chat(msg: string): void;
  on(ev: "messagestr", fn: (msg: string, position: string) => void): unknown;
  off(ev: "messagestr", fn: (msg: string, position: string) => void): unknown;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MAX_COMMAND_LENGTH = 256;

export function normalizeCommand(cmd: string): string {
  const t = cmd.trim();
  const normalized = t.startsWith("/") ? t : `/${t}`;
  // mineflayer's bot.chat splits longer messages into several chat lines, which breaks the command.
  if (normalized.length > MAX_COMMAND_LENGTH) {
    throw new UserFacingError(`コマンドが長すぎます (${normalized.length} 文字、上限 ${MAX_COMMAND_LENGTH})。分割してください。`);
  }
  return normalized;
}

/** Runs `body` while collecting chat messages (action bar excluded); always detaches the listener. */
async function withCollector(bot: ChatBot, body: (messages: string[]) => Promise<void>): Promise<string[]> {
  const messages: string[] = [];
  const listener = (msg: string, position: string) => {
    if (position !== "game_info") messages.push(msg);
  };
  bot.on("messagestr", listener);
  try {
    await body(messages);
  } finally {
    bot.off("messagestr", listener);
  }
  return messages;
}

export async function runCommand(
  bot: ChatBot,
  command: string,
  collectMs = 1000,
): Promise<{ command: string; messages: string[] }> {
  const normalized = normalizeCommand(command);
  const messages = await withCollector(bot, async () => {
    bot.chat(normalized);
    await sleep(collectMs);
  });
  return { command: normalized, messages };
}

export async function runCommands(
  bot: ChatBot,
  commands: string[],
  opts: { delayMs?: number; collectMs?: number } = {},
): Promise<{ sent: number; messages: string[] }> {
  const delayMs = opts.delayMs ?? 50;
  const collectMs = opts.collectMs ?? 1000;
  const normalized = commands.map(normalizeCommand); // validate every command before sending any
  let sent = 0;
  const messages = await withCollector(bot, async () => {
    for (const [i, cmd] of normalized.entries()) {
      if (i > 0) await sleep(delayMs);
      bot.chat(cmd);
      sent++;
    }
    await sleep(collectMs);
  });
  return { sent, messages };
}
