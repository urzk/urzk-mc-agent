import { createServer } from "node:net";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { teleportBot } from "../bot/teleport.js";
import { UserFacingError } from "../errors.js";
import type { Vec3Tuple } from "../types.js";
import { createStateRemap, remapColumnJson, type StateRemap } from "./stateRemap.js";

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 576;
const CANVAS_TIMEOUT_MS = 30_000;
const VIEW_DISTANCE = 4; // chunks; 6 was too heavy for slower machines
/** Rendering is done when two frames taken FRAME_INTERVAL_MS apart are identical (or after MAX_RENDER_WAIT_MS). */
const MIN_RENDER_WAIT_MS = 2000;
const FRAME_INTERVAL_MS = 1000;
const MAX_RENDER_WAIT_MS = 20_000;

type Page = {
  setViewport(v: { width: number; height: number }): Promise<void>;
  goto(url: string): Promise<unknown>;
  waitForSelector(sel: string, o: { timeout: number }): Promise<unknown>;
  screenshot(o: { type: "png" }): Promise<Uint8Array>;
};
type Session = { bot: Bot; closeViewer(): Promise<void>; browser: { close(): Promise<void> }; page: Page };

let session: Session | undefined;
let starting: Promise<Session> | undefined;
let queue: Promise<unknown> = Promise.resolve();

export function screenshotUnavailable(cause: unknown): UserFacingError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const missing = /Cannot find (?:module|package) '([^']+)'/.exec(reason);
  let hint = "";
  if (/Could not find Chrome|Browser was not found|Could not find expected browser/i.test(reason)) {
    hint = " Run `npx puppeteer browsers install chrome` once, then retry.";
  } else if (missing) {
    hint = ` Try \`npm rebuild ${missing[1]}\` or \`npm install\`, then retry.`;
  }
  return new UserFacingError(`screenshot unavailable: ${reason}.${hint}`);
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

// Deep imports are loaded by variable specifier: they are untyped CJS and must not be resolved at module load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(m);

/**
 * Minimal re-implementation of prismarine-viewer's mineflayer() server. The top-level package needs the
 * native `canvas` module, listens on all interfaces, and lets malformed 'mouseClick' payloads crash Node.
 */
async function startViewer(bot: Bot, port: number): Promise<() => Promise<void>> {
  const [{ default: http }, { default: express }, { Server }, wv, common, ver] = await Promise.all([
    load("node:http"),
    load("express"),
    load("socket.io"),
    load("prismarine-viewer/viewer/lib/worldView.js"),
    load("prismarine-viewer/lib/common.js"),
    load("prismarine-viewer/viewer/lib/version.js"),
  ]);
  const { getVersion, supportedVersions } = ver.default ?? ver;
  const viewerVersion = viewerVersionFor(bot.version, getVersion, supportedVersions);
  const remap = createStateRemap(bot.version, viewerVersion);
  const WorldView = wv.WorldView ?? wv.default?.WorldView;
  const setupRoutes = common.setupRoutes ?? common.default?.setupRoutes;
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { path: "/socket.io" });
  setupRoutes(app, "");
  let active: unknown;

  io.on("connection", (socket: any) => {
    if (active) {
      socket.disconnect(true);
      return;
    }
    active = socket;
    socket.emit("version", viewerVersion);
    // WorldView only needs emit(); its 'mouseClick' handler (which throws on malformed payloads) is dropped.
    const emitter = { on: () => {}, emit: (event: string, data: any) => socket.emit(event, translate(event, data, remap)) };
    const worldView = new WorldView(bot.world, VIEW_DISTANCE, bot.entity.position, emitter);
    const swallow = (e: unknown) => console.error("viewer error:", e);
    worldView.init(bot.entity.position).catch(swallow);
    const botPosition = () => {
      socket.emit("position", { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true, pitch: bot.entity.pitch });
      worldView.updatePosition(bot.entity.position).catch(swallow);
    };
    bot.on("move", botPosition);
    worldView.listenToBot(bot);
    socket.on("disconnect", () => {
      bot.removeListener("move", botPosition);
      worldView.removeListenersFromBot(bot);
      if (active === socket) active = undefined;
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      httpServer.on("error", (e: unknown) => console.error("viewer server error:", e));
      resolve();
    });
  });
  return () =>
    new Promise<void>((resolve) => {
      io.close(() => resolve()); // also closes the http server and disconnects sockets
    });
}

/** The viewer ships assets for a fixed list of versions; newer servers fall back to the latest one. */
export function viewerVersionFor(
  version: string,
  getVersion: (v: string) => string | null,
  supported: string[],
): string {
  return getVersion(version) ?? supported[supported.length - 1];
}

/** Rewrites block state ids in viewer events when the viewer renders an older version's registry. */
export function translate(event: string, data: any, remap: StateRemap | null): any {
  if (!remap) return data;
  if (event === "loadChunk") return { ...data, chunk: remapColumnJson(data.chunk, remap) };
  if (event === "blockUpdate") return { ...data, stateId: remap(data.stateId) };
  return data;
}

async function startSession(bot: Bot): Promise<Session> {
  let closeViewer: (() => Promise<void>) | undefined;
  let browser: { close(): Promise<void> } | undefined;
  try {
    const puppeteer = await import("puppeteer");
    const port = await freePort();
    closeViewer = await startViewer(bot, port);
    const launched = await puppeteer.default.launch({ headless: true, timeout: 30_000 });
    browser = launched;
    const page = await launched.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    return { bot, closeViewer, browser, page } as unknown as Session;
  } catch (e) {
    await browser?.close().catch(() => {});
    await closeViewer?.().catch(() => {});
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
  await s.closeViewer().catch((e: unknown) => console.error("viewer close failed:", e));
  await s.browser.close().catch((e: unknown) => console.error("browser close failed:", e));
}

/** Runs `fn` after all previously queued jobs; a failed job does not break the chain. */
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function takeScreenshot(
  bot: Bot,
  opts: { position: Vec3Tuple; lookAt: Vec3Tuple; width?: number; height?: number },
): Promise<Buffer> {
  return serialized(() => capture(bot, opts));
}

/**
 * Takes frames until two consecutive ones are identical, i.e. chunk meshing has finished.
 * Slow machines need far more than a fixed delay; moving entities make it fall back to the max wait.
 */
export async function waitForStableFrame(
  shoot: () => Promise<Uint8Array>,
  opts = { minMs: MIN_RENDER_WAIT_MS, intervalMs: FRAME_INTERVAL_MS, maxMs: MAX_RENDER_WAIT_MS },
): Promise<Buffer> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const start = Date.now();
  await sleep(opts.minMs);
  let prev = Buffer.from(await shoot());
  while (Date.now() - start < opts.maxMs) {
    await sleep(opts.intervalMs);
    const next = Buffer.from(await shoot());
    if (next.equals(prev)) return next;
    prev = next;
  }
  return prev;
}

async function capture(
  bot: Bot,
  opts: { position: Vec3Tuple; lookAt: Vec3Tuple; width?: number; height?: number },
): Promise<Buffer> {
  const s = await getSession(bot);
  await teleportBot(bot, opts.position);
  await bot.lookAt(new Vec3(...opts.lookAt), true);
  try {
    await s.page.setViewport({ width: opts.width ?? DEFAULT_WIDTH, height: opts.height ?? DEFAULT_HEIGHT });
    await s.page.waitForSelector("canvas", { timeout: CANVAS_TIMEOUT_MS });
    return await waitForStableFrame(() => s.page.screenshot({ type: "png" }));
  } catch (e) {
    throw new UserFacingError(`screenshot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
