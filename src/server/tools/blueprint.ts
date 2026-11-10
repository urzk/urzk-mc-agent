import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyBlueprint, blueprintCenter } from "../../blueprint/apply.js";
import { BlueprintSchema } from "../../blueprint/schema.js";
import { verifyBlueprint } from "../../blueprint/verify.js";
import { teleportBot } from "../../bot/teleport.js";
import { runCommands } from "../../commands/collector.js";
import { makeBlockReader } from "../../inspect/blockReader.js";
import type { ToolContext } from "../createServer.js";
import { jsonResult, safe } from "../result.js";

const Origin = z
  .tuple([z.number().int(), z.number().int(), z.number().int()])
  .describe("Absolute world position [x, y, z] that blueprint coordinates are relative to");

export function registerBlueprintTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "apply_blueprint",
    {
      description:
        "Compile a blueprint into /fill, /setblock (and WorldEdit) commands and run them. The bot first teleports " +
        "to the centre of the build area (needs op) so the chunks are loaded. Use dryRun=true to only see the commands.",
      inputSchema: { blueprint: BlueprintSchema, origin: Origin, dryRun: z.boolean().optional() },
    },
    safe(async ({ blueprint, origin, dryRun }) => {
      // The bot is read lazily so that dryRun works without a connection.
      const result = await applyBlueprint(
        { teleport: (pos) => teleportBot(ctx.bots.bot, pos), run: (commands) => runCommands(ctx.bots.bot, commands) },
        blueprint,
        origin,
        { dryRun, selfName: ctx.bots.status().username },
      );
      return jsonResult(result);
    }),
  );

  server.registerTool(
    "verify_blueprint",
    {
      description:
        "Compare the world with the blueprint (after teleporting to the build area) and report mismatches " +
        "(first 50, plus a count of the rest). Run after apply_blueprint.",
      inputSchema: { blueprint: BlueprintSchema, origin: Origin },
    },
    safe(async ({ blueprint, origin }) => {
      const bot = ctx.bots.bot;
      const center = blueprintCenter(blueprint, origin);
      if (center) await teleportBot(bot, center);
      return jsonResult(verifyBlueprint(blueprint, origin, makeBlockReader(bot)));
    }),
  );
}
