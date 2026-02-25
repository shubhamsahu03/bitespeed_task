import { validateEnv } from "./lib/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

// Validate environment before anything else touches the DB
validateEnv();

import app from "./app";
import { Server } from "http";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server: Server = app.listen(PORT, () => {
  logger.info("server started", { port: PORT, env: process.env.NODE_ENV ?? "development" });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info("shutdown signal received", { signal });

  server.close(async () => {
    logger.info("http server closed");
    try {
      await prisma.$disconnect();
      logger.info("database disconnected");
      process.exit(0);
    } catch (err) {
      logger.error("error during shutdown", {
        message: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  });

  // Force-kill if graceful shutdown takes too long
  setTimeout(() => {
    logger.error("shutdown timeout — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error("uncaught exception", { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", { reason: String(reason) });
  process.exit(1);
});
