/**
 * Minimal privacy worker shell. Retention, erasure, and export jobs arrive
 * with DM-050+; DM-001 provides startup and graceful SIGTERM shutdown only.
 */
const WORKER_NAME = "@deutsch-mate/privacy-worker";

function logEvent(message: string): void {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), service: WORKER_NAME, message }),
  );
}

function waitForShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    process.once("SIGTERM", () => resolve("SIGTERM"));
    process.once("SIGINT", () => resolve("SIGINT"));
  });
}

logEvent("worker started");
const keepAliveTimer = setInterval(() => {
  /* keep the event loop alive until real consumers exist */
}, 60_000);

const signal = await waitForShutdownSignal();
logEvent(`received ${signal}; shutting down gracefully`);
clearInterval(keepAliveTimer);
logEvent("worker stopped");
