import { createPrismaClient } from "@src/shared/infrastructure/db";
import request from "supertest";
import { insertTask, insertUser, insertWorksite, truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

const LINDA = "00000000-0000-4000-8000-000000000001";
const MARK = "00000000-0000-4000-8000-000000000002";
const UNKNOWN = "00000000-0000-4000-8000-000000000999";
const TOWNHOUSE = "00000000-0000-4000-8000-000000000101";
const MISSING_WORKSITE = "00000000-0000-4000-8000-000000000199";

const UNAUTHENTICATED = {
  error: {
    code: "UNAUTHENTICATED",
    message:
      "Send X-Actor-Id as the UUID of a known user and X-Actor-Role as that user's role: FOREMAN or SITE_SUPERVISOR.",
  },
};

describe("caller identity (US2)", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app = createTestApp(prisma);

  function viewTownhouse(headers: Record<string, string>): request.Test {
    return request(app).get(`/worksites/${TOWNHOUSE}`).set(headers);
  }

  beforeEach(async () => {
    await truncateAll(prisma);
    await insertUser(prisma, { id: LINDA, name: "Linda", role: "SITE_SUPERVISOR" });
    await insertUser(prisma, { id: MARK, name: "Mark", role: "FOREMAN" });
    await insertWorksite(prisma, { id: TOWNHOUSE, supervisorId: LINDA });
    await insertTask(prisma, { worksiteId: TOWNHOUSE, assigneeId: MARK });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts a known user acting in their stored role", async () => {
    const response = await viewTownhouse({ "X-Actor-Id": MARK, "X-Actor-Role": "FOREMAN" });

    expect(response.status).toBe(200);
  });

  it.each([
    ["no identity headers (US2-1)", {}],
    ["an ID that is not a UUID (US2-5)", { "X-Actor-Id": "mark", "X-Actor-Role": "FOREMAN" }],
    ["a role in lower case (US2-5)", { "X-Actor-Id": MARK, "X-Actor-Role": "foreman" }],
    ["a role outside the glossary (US2-5)", { "X-Actor-Id": MARK, "X-Actor-Role": "PROJECT_MANAGER" }],
    ["an unknown user (US2-2)", { "X-Actor-Id": UNKNOWN, "X-Actor-Role": "FOREMAN" }],
    ["Mark claiming SITE_SUPERVISOR (US2-3)", { "X-Actor-Id": MARK, "X-Actor-Role": "SITE_SUPERVISOR" }],
    ["Linda claiming FOREMAN (US2-4)", { "X-Actor-Id": LINDA, "X-Actor-Role": "FOREMAN" }],
  ])("refuses %s with 401 and no worksite data (SC-003)", async (_case, headers) => {
    const response = await viewTownhouse(headers);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it("gives an unknown user and a role mismatch identical responses (FR-005)", async () => {
    const unknown = await viewTownhouse({ "X-Actor-Id": UNKNOWN, "X-Actor-Role": "FOREMAN" });
    const mismatch = await viewTownhouse({ "X-Actor-Id": MARK, "X-Actor-Role": "SITE_SUPERVISOR" });

    expect([unknown.status, unknown.body]).toEqual([mismatch.status, mismatch.body]);
  });

  it("refuses an unknown caller before looking up the worksite, so 401 and not 404", async () => {
    const response = await request(app)
      .get(`/worksites/${MISSING_WORKSITE}`)
      .set({ "X-Actor-Id": UNKNOWN, "X-Actor-Role": "FOREMAN" });

    expect(response.status).toBe(401);
  });

  it("answers the liveness check without identity (US2-6)", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
  });
});
