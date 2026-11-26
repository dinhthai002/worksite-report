import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { insertUser, truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

const LINDA = "00000000-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request handling (FR-020 to FR-023)", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createTestApp(prisma);

  beforeEach(async () => {
    await truncateAll(prisma);
    await insertUser(prisma, { id: LINDA, name: "Linda", role: "SITE_SUPERVISOR" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuses an unknown route with 404 ROUTE_NOT_FOUND (FR-021)", async () => {
    const response = await request(app).get("/nowhere").set({ "X-Actor-Id": LINDA, "X-Actor-Role": "SITE_SUPERVISOR" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "ROUTE_NOT_FOUND", message: "There is no route for GET /nowhere." },
    });
  });

  it("refuses an unreadable JSON body with 400 MALFORMED_JSON before checking identity (FR-022)", async () => {
    const response = await request(app).post("/worksites").set("Content-Type", "application/json").send("{");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: "MALFORMED_JSON", message: "The request body is not valid JSON." },
    });
  });

  it("echoes a safe X-Request-Id (FR-023)", async () => {
    const response = await request(app).get("/health").set("X-Request-Id", "req-42-abc");

    expect(response.headers["x-request-id"]).toBe("req-42-abc");
  });

  it.each([
    ["missing", undefined],
    ["unsafe", "bad id!"],
  ])("generates a UUID when X-Request-Id is %s (FR-023)", async (_case, requestId) => {
    const call = request(app).get("/health");
    const response = await (requestId === undefined ? call : call.set("X-Request-Id", requestId));

    expect(response.headers["x-request-id"]).toMatch(UUID);
  });
});
