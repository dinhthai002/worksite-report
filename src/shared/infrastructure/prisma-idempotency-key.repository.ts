import type { Prisma } from "@prisma/client";
import type { UserId } from "../domain/actor";
import type { DatabaseClient } from "./db";
import type { IdempotencyKeyRepository, StoredKey } from "./http/idempotency.middleware";

/** Request keys in the idempotency_keys table, one row per actor and key (BR-14, research R9). */
export class PrismaIdempotencyKeyRepository implements IdempotencyKeyRepository {
  private readonly client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.client = client;
  }

  async claim(actorId: UserId, key: string, requestHash: string): Promise<boolean> {
    // INSERT … ON CONFLICT DO NOTHING: the primary key decides which of two concurrent claims wins (DB-02).
    const inserted = await this.client.idempotencyKey.createMany({
      data: [{ actorId, key, requestHash }],
      skipDuplicates: true,
    });
    return inserted.count === 1;
  }

  async find(actorId: UserId, key: string): Promise<StoredKey | undefined> {
    const row = await this.client.idempotencyKey.findUnique({ where: { actorKey: { actorId, key } } });
    if (row === null) {
      return undefined;
    }
    return { requestHash: row.requestHash, responseStatus: row.responseStatus, responseBody: row.responseBody };
  }

  async complete(actorId: UserId, key: string, status: number, body: unknown): Promise<void> {
    await this.client.idempotencyKey.update({
      where: { actorKey: { actorId, key } },
      // The body is what res.json was given, so it is JSON.
      data: { responseStatus: status, responseBody: body as Prisma.InputJsonValue, completedAt: new Date() },
    });
  }

  async release(actorId: UserId, key: string): Promise<void> {
    await this.client.idempotencyKey.deleteMany({ where: { actorId, key, completedAt: null } });
  }
}
