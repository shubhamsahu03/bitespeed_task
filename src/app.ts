import express, { Request, Response, NextFunction } from "express";
import { identifyController } from "./controllers/identify.controller";
import { logger } from "./lib/logger";

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info("incoming request", { method: req.method, path: req.path });
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/identify", identifyController);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    const isClientError = statusCode < 500;

    if (!isClientError) {
      logger.error("unhandled error", {
        message: err.message,
        stack: err.stack,
      });
    }

    res.status(statusCode).json({
      error: isClientError ? err.message : "Internal server error",
    });
  } else {
    logger.error("unknown error", { err });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;
