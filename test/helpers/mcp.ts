import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function withClient<T>(server: McpServer, fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export function listToolNames(server: McpServer): Promise<string[]> {
  return withClient(server, async (client) => (await client.listTools()).tools.map((t) => t.name));
}

export function callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return withClient(server, async (client) => (await client.callTool({ name, arguments: args })) as ToolResult);
}
