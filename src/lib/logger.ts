type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...meta,
  };
  const output = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
