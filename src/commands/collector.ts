export interface ChatBot {
  chat(msg: string): void;
  on(ev: "messagestr", fn: (msg: string, position: string) => void): unknown;
  off(ev: "messagestr", fn: (msg: string, position: string) => void): unknown;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function normalizeCommand(cmd: string): string {
  const t = cmd.trim();
  return t.startsWith("/") ? t : `/${t}`;
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
  let sent = 0;
  const messages = await withCollector(bot, async () => {
    for (const [i, cmd] of commands.entries()) {
      if (i > 0) await sleep(delayMs);
      bot.chat(normalizeCommand(cmd));
      sent++;
    }
    await sleep(collectMs);
  });
  return { sent, messages };
}
