import { createApp } from "@src/app";
import { checkDatabase, createPrismaClient } from "@src/shared/infrastructure/db";
import { createLogger } from "@src/shared/infrastructure/logger";
import request from "supertest";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error(
    "DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL in test/setup.ts.",
  );
}

describe("GET /health", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createApp({ logger: createLogger("silent"), checkDatabase: () => checkDatabase(prisma) });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 200 when the database is reachable, without actor headers", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });
});
