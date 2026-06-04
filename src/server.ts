import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = buildApp({
  config: env,
});

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  app.log.info({ signal }, "Shutdown signal received.");

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Failed to close server cleanly.");
    process.exit(1);
  }
}

async function start() {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(
      {
        host: env.HOST,
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
      },
      "Server started.",
    );
  } catch (error) {
    app.log.error({ err: error }, "Failed to start server.");
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start();
