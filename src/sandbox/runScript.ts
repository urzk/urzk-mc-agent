import vm from "node:vm";

export type ScriptOutcome = { result: unknown; logs: string[]; error?: string };

function formatLogArg(a: unknown): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

function errorMessage(e: unknown): string {
  // Errors thrown inside the vm context come from another realm, so avoid `instanceof`.
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

function normalizeResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

/** Runs `code` as the body of an async function in a vm context exposing only `globals`, `log` and `sleep`. */
export async function runScript(
  code: string,
  globals: Record<string, unknown>,
  timeoutMs: number,
): Promise<ScriptOutcome> {
  const logs: string[] = [];
  const timeoutMessage = `Timed out after ${timeoutMs}ms`;
  const context = vm.createContext({
    ...globals,
    log: (...args: unknown[]) => {
      logs.push(args.map(formatLogArg).join(" "));
    },
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const promise = vm.runInContext(`(async () => {\n${code}\n})()`, context, { timeout: timeoutMs }) as Promise<unknown>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    const result = normalizeResult(await Promise.race([promise, timeout]));
    return { result, logs };
  } catch (e) {
    const message = errorMessage(e);
    return { result: undefined, logs, error: /timed out/i.test(message) ? timeoutMessage : message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
