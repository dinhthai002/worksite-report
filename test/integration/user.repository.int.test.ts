import { toUserId } from "@src/shared/domain/actor";
import { createPrismaClient } from "@src/shared/infrastructure/db";
import { PrismaUserRepository } from "@src/shared/infrastructure/prisma-user.repository";
import { insertUser, truncateAll } from "../support/database";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. Integration tests must run through Jest, which starts PostgreSQL.");
}

describe("PrismaUserRepository", () => {
  const prisma = createPrismaClient(databaseUrl);
  const repository = new PrismaUserRepository(prisma);

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(["FOREMAN", "SITE_SUPERVISOR"] as const)("returns the stored role %s for a known user", async (role) => {
    const user = await insertUser(prisma, { role });

    expect(await repository.findRoleById(toUserId(user.id))).toBe(role);
  });

  it("returns undefined for an unknown user (FR-003)", async () => {
    expect(await repository.findRoleById(toUserId("00000000-0000-4000-8000-000000000999"))).toBeUndefined();
  });
});
