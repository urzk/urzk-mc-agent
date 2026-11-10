import mineflayer, { type Bot } from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import type { AppConfig } from "../config.js";
import { NotConnectedError } from "../errors.js";
import type { Vec3Tuple } from "../types.js";

export type StatusSnapshot = {
  connected: boolean;
  lastDisconnectReason?: string;
  username?: string;
  position?: Vec3Tuple;
  yaw?: number;
  pitch?: number;
  gameMode?: string;
  health?: number;
  heldItem?: string | null;
  nearbyPlayers?: string[];
};

export type ConnectResult =
  | { state: "connected"; status: StatusSnapshot }
  | { state: "awaiting_microsoft_login"; verificationUri: string; userCode: string; message: string };

export type ConnectOptions = Partial<Pick<AppConfig, "host" | "port" | "username" | "auth" | "version">>;

const SPAWN_TIMEOUT_MS = 60_000;

export class BotManager {
  private current: Bot | undefined;
  private spawned = false;
  private lastDisconnectReason: string | undefined;

  constructor(private readonly config: AppConfig) {}

  get bot(): Bot {
    if (!this.current || !this.spawned) {
      const hint = this.current ? "接続処理中、または Microsoft ログイン待ちです。get_status で接続完了を確認してください" : undefined;
      throw new NotConnectedError(this.lastDisconnectReason, hint);
    }
    return this.current;
  }

  async connect(opts: ConnectOptions): Promise<ConnectResult> {
    this.disconnect();
    this.lastDisconnectReason = undefined;
    this.spawned = false;
    const cfg = { ...this.config, ...stripUndefined(opts) };

    return new Promise<ConnectResult>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };

      const bot = mineflayer.createBot({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        auth: cfg.auth,
        version: cfg.version,
        profilesFolder: ".cache/msa",
        logErrors: false, // mineflayer would console.log errors to stdout, corrupting the MCP stream
        onMsaCode: (data) =>
          settle(() =>
            resolve({
              state: "awaiting_microsoft_login",
              verificationUri: data.verification_uri,
              userCode: data.user_code,
              message: data.message,
            }),
          ),
      });
      this.current = bot;
      bot.loadPlugin(pathfinder);

      const drop = (reason: string) => {
        // Ignore events from a bot that has already been replaced or discarded.
        if (this.current !== bot) return;
        this.lastDisconnectReason = reason;
        this.current = undefined;
        this.spawned = false;
        settle(() => reject(new Error(`Connection failed: ${reason}`)));
      };

      bot.once("spawn", () => {
        if (this.current === bot) this.spawned = true;
        settle(() => resolve({ state: "connected", status: this.status() }));
      });
      bot.on("kicked", (reason) => drop(`kicked: ${typeof reason === "string" ? reason : JSON.stringify(reason)}`));
      bot.on("error", (err) => {
        console.error("bot error:", err);
        drop(`error: ${err.message}`);
      });
      bot.on("end", (reason) => drop(`disconnected: ${reason}`));

      // Microsoft login can legitimately outlive the timeout, but then onMsaCode has already resolved.
      timer = setTimeout(() => {
        settle(() => {
          if (this.current === bot) {
            this.current = undefined;
            this.spawned = false;
            this.lastDisconnectReason = `timed out waiting for spawn (${SPAWN_TIMEOUT_MS / 1000}s)`;
          }
          bot.end();
          reject(new Error(`Connection failed: ${this.lastDisconnectReason}`));
        });
      }, SPAWN_TIMEOUT_MS);
    });
  }

  disconnect(): void {
    const bot = this.current;
    if (!bot) return;
    this.current = undefined;
    this.spawned = false;
    bot.end();
  }

  status(): StatusSnapshot {
    const bot = this.current;
    if (!bot || !this.spawned || !bot.entity) {
      return { connected: false, ...(this.lastDisconnectReason ? { lastDisconnectReason: this.lastDisconnectReason } : {}) };
    }
    const p = bot.entity.position;
    return {
      connected: true,
      username: bot.username,
      position: [p.x, p.y, p.z],
      yaw: bot.entity.yaw,
      pitch: bot.entity.pitch,
      gameMode: bot.game?.gameMode,
      health: bot.health,
      heldItem: bot.heldItem?.name ?? null,
      nearbyPlayers: Object.keys(bot.players).filter((n) => n !== bot.username),
    };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
