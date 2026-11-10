// 結合確認スクリプト: 実サーバーに接続して小屋を建て、照合・ドア操作・スクリーンショットまで通す。
// 使い方: .env を用意して `npm run smoke`（Bot は OP であること）。
import { mkdirSync, writeFileSync } from "node:fs";
import { Vec3 } from "vec3";
import { applyBlueprint } from "../src/blueprint/apply.js";
import { BlueprintSchema } from "../src/blueprint/schema.js";
import { verifyBlueprint } from "../src/blueprint/verify.js";
import { BotManager } from "../src/bot/manager.js";
import { runCommand, runCommands } from "../src/commands/collector.js";
import { loadConfig } from "../src/config.js";
import { makeBlockReader } from "../src/inspect/blockReader.js";
import { closeScreenshot, takeScreenshot } from "../src/inspect/screenshot.js";
import { teleportBot } from "../src/bot/teleport.js";
import type { Vec3Tuple } from "../src/types.js";

try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const hut = BlueprintSchema.parse({
  palette: {
    B: "stone_bricks",
    S: "oak_slab[type=bottom]",
  },
  ops: [
    { op: "hollow", from: [0, 0, 0], to: [4, 3, 4], block: "oak_planks" },
    { op: "fill", from: [0, 0, 0], to: [4, 0, 4], block: "B" },
    { op: "set", at: [2, 1, 0], block: "oak_door[facing=south,half=lower,open=false]" },
    { op: "set", at: [2, 2, 0], block: "oak_door[facing=south,half=upper,open=false]" },
    { op: "layers", at: [0, 3, 0], rows: [["SSSSS", "SSSSS", "SSSSS", "SSSSS", "SSSSS"]] },
  ],
});

async function main(): Promise<number> {
  const config = loadConfig(process.env);
  const bots = new BotManager(config);
  console.error(`connecting to ${config.host}:${config.port} as ${config.username} (${config.auth})...`);
  try {
    const res = await bots.connect({});
    if (res.state !== "connected") {
      console.error(`Microsoft login required before the smoke test can run: ${res.message}`);
      console.error("Complete the login, then re-run (the token is cached in .cache/msa).");
      return 1;
    }
  } catch (e) {
    console.error(`smoke: could not connect to ${config.host}:${config.port}: ${e instanceof Error ? e.message : String(e)}`);
    console.error("Is the server running, and do MC_HOST / MC_PORT / MC_VERSION in .env match it?");
    return 1;
  }

  try {
    const bot = bots.bot;
    console.error((await runCommand(bot, "/gamemode creative")).messages.join(" | "));

    const p = bot.entity.position;
    const origin: Vec3Tuple = [Math.floor(p.x) + 5, Math.floor(p.y), Math.floor(p.z)];
    console.error(`origin: ${origin.join(",")}`);

    const applied = await applyBlueprint(
      { teleport: (pos) => teleportBot(bot, pos), run: (commands) => runCommands(bot, commands) },
      hut,
      origin,
    );
    console.error(`commands sent: ${applied.sent}`);
    for (const m of applied.messages) console.error(`  server: ${m}`);

    const readBlock = makeBlockReader(bot);
    const result = verifyBlueprint(hut, origin, readBlock);
    console.error(`checked: ${result.checked}`);
    console.error(`mismatches: ${result.mismatches.length + result.truncated}`);
    for (const m of result.mismatches) console.error(`  ${m.pos.join(",")} expected ${m.expected} actual ${m.actual}`);

    const door: Vec3Tuple = [origin[0] + 2, origin[1] + 1, origin[2]];
    const doorBlock = () => {
      const b = bot.blockAt(new Vec3(...door));
      if (!b) throw new Error(`door chunk not loaded at ${door.join(",")}`);
      return b;
    };
    const before = String(doorBlock().getProperties().open);
    await bot.activateBlock(doorBlock());
    await bot.waitForTicks(5);
    const after = String(doorBlock().getProperties().open);
    console.error(`door open: ${before} -> ${after}`);

    const png = await takeScreenshot(bot, {
      position: [origin[0] + 2, origin[1] + 3, origin[2] - 6],
      lookAt: [origin[0] + 2, origin[1] + 1, origin[2] + 2],
    });
    mkdirSync(".cache", { recursive: true });
    writeFileSync(".cache/smoke.png", png);
    console.error("screenshot saved: .cache/smoke.png");

    return result.mismatches.length + result.truncated === 0 && before !== after ? 0 : 1;
  } finally {
    await closeScreenshot();
    bots.disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`smoke failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  },
);
