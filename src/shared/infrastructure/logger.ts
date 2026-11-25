import pino, { type Logger } from "pino";
import type { LogLevel } from "../../config";

export type { Logger };

/** Structured JSON logger (LOG-01). Created once in main.ts and passed to what needs it. */
export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string): { level: string } => ({ level: label }),
    },
  });
}
