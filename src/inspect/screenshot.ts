import { createServer } from "node:net";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { teleportBot } from "../bot/teleport.js";
import { UserFacingError } from "../errors.js";
import type { Vec3Tuple } from "../types.js";

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 576;
const RENDER_WAIT_MS = 3000;
const CANVAS_TIMEOUT_MS = 30_000;

type Session = {
  bot: Bot;
  port: number;
  browser: { close(): Promise<void> };
  page: {
    setViewport(v: { width: number; height: number }): Promise<void>;
    goto(url: string): Promise<unknown>;
    waitForSelector(sel: string, o: { timeout: number }): Promise<unknown>;
    screenshot(o: { type: "png" }): Promise<Uint8Array>;
  };
};

let session: Session | undefined;
let starting: Promise<Session> | undefined;

export function screenshotUnavailable(cause: unknown): UserFacingError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new UserFacingError(
    `screenshot unavailable: ${reason}. Run \`npx puppeteer browsers install chrome\` once, then retry.`,
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function startSession(bot: Bot): Promise<Session> {
  try {
    const [viewer, puppeteer] = await Promise.all([import("prismarine-viewer"), import("puppeteer")]);
    const port = await freePort();
    // prismarine-viewer only logs via console.log (redirected to stderr by stdoutGuard).
    viewer.mineflayer(bot, { firstPerson: true, viewDistance: 6, port });
    let browser;
    try {
      browser = await puppeteer.default.launch({ headless: true, timeout: 30_000 });
    } catch (e) {
      (bot as unknown as { viewer?: { close(): void } }).viewer?.close();
      throw e;
    }
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}`);
    return { bot, port, browser, page } as unknown as Session;
  } catch (e) {
    throw screenshotUnavailable(e);
  }
}

async function getSession(bot: Bot): Promise<Session> {
  if (session && session.bot !== bot) await closeScreenshot();
  if (session) return session;
  starting ??= startSession(bot).finally(() => {
    starting = undefined;
  });
  session = await starting;
  return session;
}

/** Closes the viewer web server and headless browser (called when the bot disconnects). */
export async function closeScreenshot(): Promise<void> {
  const pending = starting;
  const s = session ?? (pending ? await pending.catch(() => undefined) : undefined);
  session = undefined;
  if (!s) return;
  try {
    (s.bot as unknown as { viewer?: { close(): void } }).viewer?.close();
  } catch (e) {
    console.error("viewer close failed:", e);
  }
  await s.browser.close().catch((e: unknown) => console.error("browser close failed:", e));
}

export async function takeScreenshot(
  bot: Bot,
  opts: { position: Vec3Tuple; lookAt: Vec3Tuple; width?: number; height?: number },
): Promise<Buffer> {
  const s = await getSession(bot);
  await teleportBot(bot, opts.position);
  await bot.lookAt(new Vec3(...opts.lookAt), true);
  try {
    await s.page.setViewport({ width: opts.width ?? DEFAULT_WIDTH, height: opts.height ?? DEFAULT_HEIGHT });
    await s.page.waitForSelector("canvas", { timeout: CANVAS_TIMEOUT_MS });
    await new Promise((r) => setTimeout(r, RENDER_WAIT_MS));
    return Buffer.from(await s.page.screenshot({ type: "png" }));
  } catch (e) {
    throw new UserFacingError(`screenshot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
