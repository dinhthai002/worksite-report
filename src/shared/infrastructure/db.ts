import { PrismaClient } from "@prisma/client";

/** The Prisma client. Its types stay in infrastructure (ARC-08, DB-01). */
export type DatabaseClient = PrismaClient;

export function createPrismaClient(databaseUrl: string): DatabaseClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

/** Resolves when the database answers a trivial query; rejects otherwise. */
export async function checkDatabase(client: DatabaseClient): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}
