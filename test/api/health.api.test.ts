import { createPrismaClient } from "@src/shared/infrastructure/db";
import pino from "pino";
import request from "supertest";
import { createTestApp } from "../support/test-app";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error(
    "DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL in test/setup.ts.",
  );
}

describe("GET /health", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createTestApp(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 200 when the database is reachable, without actor headers", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("returns 503 DATABASE_UNAVAILABLE and logs a warning when the database is unreachable", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino({ level: "info" }, { write: (line: string): void => void lines.push(JSON.parse(line)) });
    const unreachable = createTestApp(prisma, {
      logger,
      checkDatabase: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5432")),
    });

    const response = await request(unreachable).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { code: "DATABASE_UNAVAILABLE", message: "The database is unreachable." },
    });
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 40, msg: "health check failed: database unreachable" }),
    );
  });
});
