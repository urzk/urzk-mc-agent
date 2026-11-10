export type AppConfig = {
  host: string;
  port: number;
  username: string;
  auth: "offline" | "microsoft";
  version: string | undefined;
  enableScript: boolean;
};

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const auth = env.MC_AUTH || "offline";
  if (auth !== "offline" && auth !== "microsoft") {
    throw new Error(`MC_AUTH must be "offline" or "microsoft" (got "${auth}")`);
  }
  const port = env.MC_PORT ? Number(env.MC_PORT) : 25565;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MC_PORT must be an integer 1-65535 (got "${env.MC_PORT}")`);
  }
  return {
    host: env.MC_HOST || "localhost",
    port,
    username: env.MC_USERNAME || "ClaudeBuilder",
    auth,
    version: env.MC_VERSION || undefined,
    enableScript: (env.MC_AGENT_ENABLE_SCRIPT ?? "true").toLowerCase() !== "false",
  };
}
