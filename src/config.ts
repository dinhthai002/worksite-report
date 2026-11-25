import { z } from "zod";

/**
 * Typed, read-only configuration (architecture.md section 7). This is the only file that reads process.env (CFG-01).
 * Read once at startup; main.ts exits if a value is missing or invalid.
 */

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly databaseUrl: string;
  readonly port: number;
  readonly backdateLimitDays: number;
  readonly appTimeZone: string;
  readonly logLevel: LogLevel;
}

export type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
}

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgresql:// connection string" }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BACKDATE_LIMIT_DAYS: z.coerce.number().int().min(0).default(5),
  APP_TIME_ZONE: z
    .string()
    .default("Asia/Ho_Chi_Minh")
    .refine(isValidTimeZone, { error: "must be an IANA time zone, for example Asia/Ho_Chi_Minh" }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export function loadConfig(environment: Environment = process.env): Config {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const values = parsed.data;
  return Object.freeze({
    databaseUrl: values.DATABASE_URL,
    port: values.PORT,
    backdateLimitDays: values.BACKDATE_LIMIT_DAYS,
    appTimeZone: values.APP_TIME_ZONE,
    logLevel: values.LOG_LEVEL,
  });
}
