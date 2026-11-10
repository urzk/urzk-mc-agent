// The server must never crash: log stray async failures (viewer callbacks, unawaited script promises,
// mineflayer internals) to stderr instead of letting Node terminate the process.
export function installProcessGuards(): void {
  process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e));
  process.on("uncaughtException", (e) => console.error("uncaught exception:", e));
}
