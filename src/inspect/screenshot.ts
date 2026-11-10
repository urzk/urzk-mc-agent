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
export const DEFAULT_VIEW_DISTANCE = 4; // chunks; 6 was too heavy for slower machines as a default
export const MAX_VIEW_DISTANCE = 12;
/** Rendering is done when two frames taken FRAME_INTERVAL_MS apart are identical (or after MAX_RENDER_WAIT_MS). */
const MIN_RENDER_WAIT_MS = 2000;
const FRAME_INTERVAL_MS = 1000;
const MAX_RENDER_WAIT_MS = 20_000;
/** Meshing counts as done once no section is outstanding and no new one was queued for this long. */
const MESH_QUIET_MS = 500;
const MESH_POLL_MS = 200;

/**
 * Installed in the viewer page before its bundle runs. The viewer meshes chunk sections in Web Workers
 * ('dirty' in, 'sectionFinished' out) and keeps its own count private, so wrap Worker to count them here.
 * Without this, frames of plain sky taken before the first meshes appear look "stable".
 */
const RENDER_TRACKER_SCRIPT = `(() => {
  const st = { outstanding: new Set(), dirtied: 0, lastDirtyAt: 0 };
  window.__meshTracker = st;
  const Base = window.Worker;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (e) => {
        if (e.data && e.data.type === "sectionFinished") st.outstanding.delete(e.data.key);
      });
    }
    postMessage(msg, ...rest) {
      if (msg && msg.type === "dirty") {
        st.outstanding.add([msg.x, msg.y, msg.z].map((v) => Math.floor(v / 16) * 16).join(","));
        st.dirtied++;
        st.lastDirtyAt = performance.now();
      }
      return super.postMessage(msg, ...rest);
    }
  };
})();`;

export type MeshState = { outstanding: number; dirtied: number; msSinceDirty: number };

const readMeshState = (page: Page): Promise<MeshState> =>
  page.evaluate(`(() => {
    const st = window.__meshTracker;
    if (!st) return { outstanding: 0, dirtied: 0, msSinceDirty: Infinity };
    return { outstanding: st.outstanding.size, dirtied: st.dirtied, msSinceDirty: performance.now() - st.lastDirtyAt };
  })()`) as Promise<MeshState>;

/**
 * Waits until the page has meshed every queued chunk section. With `requireNew`, sections queued after
 * `dirtiedBefore` must show up first (chunks were just sent and may still be in flight). Gives up quietly
 * after maxMs: the frame-stability check still follows.
 */
export async function waitForMeshes(
  read: () => Promise<MeshState>,
  opts: { dirtiedBefore: number; requireNew: boolean; quietMs: number; intervalMs: number; maxMs: number },
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const st = await read();
    const started = !opts.requireNew || st.dirtied > opts.dirtiedBefore;
    if (started && st.outstanding === 0 && st.msSinceDirty >= opts.quietMs) return true;
    if (Date.now() - start >= opts.maxMs) return false;
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}

type Page = {
  setViewport(v: { width: number; height: number }): Promise<void>;
  goto(url: string): Promise<unknown>;
  waitForSelector(sel: string, o: { timeout: number }): Promise<unknown>;
  screenshot(o: { type: "png" }): Promise<Uint8Array>;
  evaluateOnNewDocument(script: string): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
};
type ViewerHandle = {
  close(): Promise<void>;
  /** Number of chunk columns sent to the page so far. */
  chunksSent(): number;
  /** Waits for the page to connect, applies viewDistance and waits until the chunks around `pos` are sent. */
  sync(pos: { x: number; y: number; z: number }, viewDistance?: number): Promise<void>;
};
type Session = { bot: Bot; viewer: ViewerHandle; browser: { close(): Promise<void> }; page: Page; captures: number };

let session: Session | undefined;
let starting: Promise<Session> | undefined;
let queue: Promise<unknown> = Promise.resolve();

export function screenshotUnavailable(cause: unknown): UserFacingError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const missing = /Cannot find (?:module|package) '([^']+)'/.exec(reason);
  let hint = "";
  if (/Could not find Chrome|Browser was not found|Could not find expected browser/i.test(reason)) {
    hint = " Run `pnpm exec puppeteer browsers install chrome` once, then retry.";
  } else if (missing) {
    hint = ` Try \`pnpm rebuild ${missing[1]}\` or \`pnpm install\`, then retry.`;
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
async function startViewer(bot: Bot, port: number): Promise<ViewerHandle> {
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
  let viewDistance = DEFAULT_VIEW_DISTANCE;
  let chunksSent = 0;
  // The connected page's WorldView and the tail of its chunk loading (kept sequential so sync() can await it).
  let current: { worldView: any; pending: Promise<unknown> } | undefined;
  const connectWaiters: (() => void)[] = [];
  const swallow = (e: unknown) => console.error("viewer error:", e);

  io.on("connection", (socket: any) => {
    if (active) {
      socket.disconnect(true);
      return;
    }
    active = socket;
    socket.emit("version", viewerVersion);
    // WorldView only needs emit(); its 'mouseClick' handler (which throws on malformed payloads) is dropped.
    const emitter = {
      on: () => {},
      emit: (event: string, data: any) => {
        if (event === "loadChunk") chunksSent++;
        socket.emit(event, translate(event, data, remap));
      },
    };
    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, emitter);
    const state = { worldView, pending: worldView.init(bot.entity.position).catch(swallow) as Promise<unknown> };
    current = state;
    connectWaiters.splice(0).forEach((resolve) => resolve());
    const botPosition = () => {
      socket.emit("position", { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true, pitch: bot.entity.pitch });
      state.pending = state.pending.then(() => worldView.updatePosition(bot.entity.position)).catch(swallow);
    };
    bot.on("move", botPosition);
    worldView.listenToBot(bot);
    socket.on("disconnect", () => {
      bot.removeListener("move", botPosition);
      worldView.removeListenersFromBot(bot);
      if (active === socket) active = undefined;
      if (current === state) current = undefined;
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
  const connected = async (): Promise<NonNullable<typeof current>> => {
    if (current) return current;
    let timer: NodeJS.Timeout | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        connectWaiters.push(resolve);
        timer = setTimeout(() => reject(new Error("viewer page did not connect")), CANVAS_TIMEOUT_MS);
      });
    } finally {
      clearTimeout(timer);
    }
    if (!current) throw new Error("viewer page disconnected");
    return current;
  };

  return {
    close: () =>
      new Promise<void>((resolve) => {
        io.close(() => resolve()); // also closes the http server and disconnects sockets
      }),
    chunksSent: () => chunksSent,
    async sync(pos, distance) {
      const state = await connected();
      const changed = distance !== undefined && distance !== state.worldView.viewDistance;
      if (distance !== undefined) {
        viewDistance = distance;
        state.worldView.viewDistance = distance;
      }
      // force=true reloads the view rect: unloads chunks now out of range and sends the newly covered ones.
      state.pending = state.pending.then(() => state.worldView.updatePosition(pos, changed)).catch(swallow);
      await state.pending;
    },
  };
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
  let viewer: ViewerHandle | undefined;
  let browser: { close(): Promise<void> } | undefined;
  try {
    const puppeteer = await import("puppeteer");
    const port = await freePort();
    viewer = await startViewer(bot, port);
    const launched = await puppeteer.default.launch({ headless: true, timeout: 30_000 });
    browser = launched;
    const page = await launched.newPage();
    await page.evaluateOnNewDocument(RENDER_TRACKER_SCRIPT);
    await page.goto(`http://127.0.0.1:${port}`);
    return { bot, viewer, browser, page, captures: 0 } as unknown as Session;
  } catch (e) {
    await browser?.close().catch(() => {});
    await viewer?.close().catch(() => {});
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
  await s.viewer.close().catch((e: unknown) => console.error("viewer close failed:", e));
  await s.browser.close().catch((e: unknown) => console.error("browser close failed:", e));
}

/** Runs `fn` after all previously queued jobs; a failed job does not break the chain. */
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export type ScreenshotOptions = {
  position: Vec3Tuple;
  lookAt: Vec3Tuple;
  width?: number;
  height?: number;
  /** Radius in chunks of the area rendered around the camera; persists for later calls. */
  viewDistance?: number;
};

export function takeScreenshot(
  bot: Bot,
  opts: ScreenshotOptions,
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

type HoverBot = {
  game: { gameMode: string };
  entity: { velocity: { x: number; y: number; z: number } };
  creative: { startFlying(): void; stopFlying(): void };
};

/**
 * Keeps the bot where it is teleported (no gravity) so a camera position in mid-air is not lost to falling
 * while the frame renders. Only in creative/spectator: elsewhere the server kicks players for flying.
 * Returns a function that restores gravity.
 */
export function holdInAir(bot: HoverBot): () => void {
  if (bot.game.gameMode !== "creative" && bot.game.gameMode !== "spectator") return () => {};
  bot.creative.startFlying();
  const v = bot.entity.velocity;
  v.x = v.y = v.z = 0;
  return () => bot.creative.stopFlying();
}

async function capture(
  bot: Bot,
  opts: ScreenshotOptions,
): Promise<Buffer> {
  const s = await getSession(bot);
  const release = holdInAir(bot);
  try {
    const chunksBefore = s.viewer.chunksSent();
    await teleportBot(bot, opts.position);
    await bot.lookAt(new Vec3(...opts.lookAt), true);
    try {
      const { dirtied } = await readMeshState(s.page);
      await s.viewer.sync(bot.entity.position, opts.viewDistance);
      await s.page.setViewport({ width: opts.width ?? DEFAULT_WIDTH, height: opts.height ?? DEFAULT_HEIGHT });
      await s.page.waitForSelector("canvas", { timeout: CANVAS_TIMEOUT_MS });
      const requireNew = s.captures++ === 0 || s.viewer.chunksSent() > chunksBefore;
      await waitForMeshes(() => readMeshState(s.page), {
        dirtiedBefore: dirtied,
        requireNew,
        quietMs: MESH_QUIET_MS,
        intervalMs: MESH_POLL_MS,
        maxMs: MAX_RENDER_WAIT_MS,
      });
      return await waitForStableFrame(() => s.page.screenshot({ type: "png" }));
    } catch (e) {
      throw new UserFacingError(`screenshot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    release();
  }
}
