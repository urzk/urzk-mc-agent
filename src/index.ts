import "./stdoutGuard.js"; // must stay first: keeps third-party console output off the MCP stdout stream
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BotManager } from "./bot/manager.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server/createServer.js";

try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const config = loadConfig(process.env);
const server = createServer({ bots: new BotManager(config), config });
await server.connect(new StdioServerTransport());
console.error("minecraft MCP server running on stdio");
