import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyBlueprint, blueprintCenter, summarizeApplyResult } from "../../blueprint/apply.js";
import { loadBlueprint } from "../../blueprint/load.js";
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

const BlueprintPath = z
  .string()
  .describe("Absolute path to a JSON file holding the blueprint, instead of passing `blueprint` inline (use for large generated blueprints)");

export function registerBlueprintTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "apply_blueprint",
    {
      description:
        "Compile a blueprint into /fill, /setblock (and WorldEdit) commands and run them. The bot first teleports " +
        "to the centre of the build area (needs op) so the chunks are loaded. Pass the blueprint inline or as blueprintPath (a JSON file). " +
        "Use dryRun=true to see the command count and the first commands. " +
        "A real run returns counts plus only the non-routine server messages (errors etc), not every command.",
      inputSchema: {
        blueprint: BlueprintSchema.optional(),
        blueprintPath: BlueprintPath.optional(),
        origin: Origin,
        dryRun: z.boolean().optional(),
      },
    },
    safe(async ({ blueprint: inline, blueprintPath, origin, dryRun }) => {
      const blueprint = await loadBlueprint({ blueprint: inline, blueprintPath });
      // The bot is read lazily so that dryRun works without a connection.
      const result = await applyBlueprint(
        { teleport: (pos) => teleportBot(ctx.bots.bot, pos), run: (commands) => runCommands(ctx.bots.bot, commands) },
        blueprint,
        origin,
        { dryRun, selfName: ctx.bots.status().username },
      );
      return jsonResult(summarizeApplyResult(result, dryRun ?? false));
    }),
  );

  server.registerTool(
    "verify_blueprint",
    {
      description:
        "Compare the world with the blueprint (after teleporting to the build area) and report mismatches " +
        "(first 50, plus a count of the rest). Run after apply_blueprint. Accepts blueprintPath like apply_blueprint. " +
        "fill ops with replace are skipped (listed in skippedOps).",
      inputSchema: { blueprint: BlueprintSchema.optional(), blueprintPath: BlueprintPath.optional(), origin: Origin },
    },
    safe(async ({ blueprint: inline, blueprintPath, origin }) => {
      const blueprint = await loadBlueprint({ blueprint: inline, blueprintPath });
      const bot = ctx.bots.bot;
      const center = blueprintCenter(blueprint, origin);
      if (center) await teleportBot(bot, center);
      return jsonResult(verifyBlueprint(blueprint, origin, makeBlockReader(bot)));
    }),
  );
}
