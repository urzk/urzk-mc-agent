import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BotManager } from "../bot/manager.js";
import type { AppConfig } from "../config.js";
import { registerBlueprintTools } from "./tools/blueprint.js";
import { registerCommandTools } from "./tools/commands.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerInspectTools } from "./tools/inspect.js";

export type ToolContext = { bots: BotManager; config: AppConfig };

const INSTRUCTIONS = `Tools for building in Minecraft through a Mineflayer bot. The bot can only act through chat commands (/ and //) and the protocol; no server-specific APIs are assumed.

Typical flow:
1. connect, then get_status.
2. Design what to build and write a blueprint.
3. apply_blueprint (use dryRun first if unsure).
4. verify_blueprint; fix any differences (re-run apply_blueprint or use run_command).
5. For contraptions: interact_block -> wait_ticks -> get_block to check state changes.
6. Use screenshot when you need to check how it looks.

Notes:
- If a tool reports the bot is not connected (or was kicked), call connect again; there is no automatic reconnect.
- With auth=microsoft, connect first returns a device code: ask the user to sign in at the given URL, then poll get_status.
- Command failures (no permission, bad syntax) show up in the chat messages returned by run_command / run_commands.`;

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "minecraft-build-agent", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerConnectionTools(server, ctx);
  registerCommandTools(server, ctx);
  registerInspectTools(server, ctx);
  registerBlueprintTools(server, ctx);
  return server;
}
