import { toUserId } from "@src/shared/domain/actor";
import { createPrismaClient } from "@src/shared/infrastructure/db";
import { PrismaIdempotencyKeyRepository } from "@src/shared/infrastructure/prisma-idempotency-key.repository";
import { insertUser, truncateAll } from "../support/database";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. Integration tests must run through Jest, which starts PostgreSQL.");
}

describe("PrismaIdempotencyKeyRepository", () => {
  const prisma = createPrismaClient(databaseUrl);
  const keys = new PrismaIdempotencyKeyRepository(prisma);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("BR-14 a second claim of the same actor and key returns false", async () => {
    const actor = toUserId((await insertUser(prisma)).id);

    const first = await keys.claim(actor, "k1", "hash-a");
    const second = await keys.claim(actor, "k1", "hash-a");

    expect([first, second]).toEqual([true, false]);
  });

  it("BR-14 of two concurrent claims of one key, exactly one wins", async () => {
    const actor = toUserId((await insertUser(prisma)).id);

    const results = await Promise.all([keys.claim(actor, "k1", "hash-a"), keys.claim(actor, "k1", "hash-a")]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("BR-14 the same key for another actor is claimed", async () => {
    const mark = toUserId((await insertUser(prisma)).id);
    const henry = toUserId((await insertUser(prisma)).id);
    await keys.claim(mark, "k1", "hash-a");

    expect(await keys.claim(henry, "k1", "hash-b")).toBe(true);
  });

  it("find returns an in-progress claim, then the stored status and body once completed", async () => {
    const actor = toUserId((await insertUser(prisma)).id);
    await keys.claim(actor, "k1", "hash-a");
    const inProgress = await keys.find(actor, "k1");

    await keys.complete(actor, "k1", 201, { id: "r1", items: [] });

    expect(inProgress).toEqual({ requestHash: "hash-a", responseStatus: null, responseBody: null });
    expect(await keys.find(actor, "k1")).toEqual({
      requestHash: "hash-a",
      responseStatus: 201,
      responseBody: { id: "r1", items: [] },
    });
  });

  it("release deletes an in-progress claim and keeps a completed one", async () => {
    const actor = toUserId((await insertUser(prisma)).id);
    await keys.claim(actor, "open", "hash-a");
    await keys.claim(actor, "done", "hash-b");
    await keys.complete(actor, "done", 200, {});

    await keys.release(actor, "open");
    await keys.release(actor, "done");

    expect(await keys.find(actor, "open")).toBeUndefined();
    expect(await keys.find(actor, "done")).toEqual(expect.objectContaining({ responseStatus: 200 }));
  });
});
