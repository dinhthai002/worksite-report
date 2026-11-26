import { ConfigError, loadConfig } from "@src/config";

const DATABASE_URL = "postgresql://user:secret@localhost:5432/worksite_report";

describe("loadConfig", () => {
  it("applies the documented defaults when only DATABASE_URL is set", () => {
    const config = loadConfig({ DATABASE_URL });

    expect(config).toEqual({
      databaseUrl: DATABASE_URL,
      port: 3000,
      backdateLimitDays: 365,
      appTimeZone: "Asia/Ho_Chi_Minh",
      logLevel: "info",
    });
  });

  it("reads every variable when set", () => {
    const config = loadConfig({
      DATABASE_URL,
      PORT: "8080",
      BACKDATE_LIMIT_DAYS: "3",
      APP_TIME_ZONE: "Europe/Paris",
      LOG_LEVEL: "debug",
    });

    expect(config).toEqual({
      databaseUrl: DATABASE_URL,
      port: 8080,
      backdateLimitDays: 3,
      appTimeZone: "Europe/Paris",
      logLevel: "debug",
    });
  });

  it("returns a read-only object", () => {
    const config = loadConfig({ DATABASE_URL });

    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    ["DATABASE_URL is missing", {}],
    ["DATABASE_URL is not a PostgreSQL URL", { DATABASE_URL: "mysql://localhost/db" }],
    ["PORT is not a number", { DATABASE_URL, PORT: "http" }],
    ["PORT is out of range", { DATABASE_URL, PORT: "70000" }],
    ["BACKDATE_LIMIT_DAYS is negative", { DATABASE_URL, BACKDATE_LIMIT_DAYS: "-1" }],
    ["APP_TIME_ZONE is not an IANA zone", { DATABASE_URL, APP_TIME_ZONE: "Mars/Olympus" }],
    ["LOG_LEVEL is unknown", { DATABASE_URL, LOG_LEVEL: "verbose" }],
  ])("throws ConfigError when %s", (_case, environment) => {
    expect(() => loadConfig(environment)).toThrow(ConfigError);
  });
});
