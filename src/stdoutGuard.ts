// stdout is reserved for the MCP protocol; send stdout-bound console methods to stderr.
export function installStdoutGuard(): void {
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

installStdoutGuard();
