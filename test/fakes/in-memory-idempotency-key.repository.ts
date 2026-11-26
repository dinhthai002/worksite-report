import type { UserId } from "@src/shared/domain/actor";
import type { IdempotencyKeyRepository, StoredKey } from "@src/shared/infrastructure/http/idempotency.middleware";

/** In-memory IdempotencyKeyRepository for unit tests (TST-06), keyed by actor and key like the real table. */
export class InMemoryIdempotencyKeyRepository implements IdempotencyKeyRepository {
  private readonly keys = new Map<string, StoredKey>();

  claim(actorId: UserId, key: string, requestHash: string): Promise<boolean> {
    const id = `${actorId}/${key}`;
    if (this.keys.has(id)) {
      return Promise.resolve(false);
    }
    this.keys.set(id, { requestHash, responseStatus: null, responseBody: null });
    return Promise.resolve(true);
  }

  find(actorId: UserId, key: string): Promise<StoredKey | undefined> {
    return Promise.resolve(this.keys.get(`${actorId}/${key}`));
  }

  complete(actorId: UserId, key: string, status: number, body: unknown): Promise<void> {
    const id = `${actorId}/${key}`;
    const stored = this.keys.get(id);
    if (stored !== undefined) {
      this.keys.set(id, { ...stored, responseStatus: status, responseBody: body });
    }
    return Promise.resolve();
  }

  release(actorId: UserId, key: string): Promise<void> {
    const id = `${actorId}/${key}`;
    if (this.keys.get(id)?.responseStatus === null) {
      this.keys.delete(id);
    }
    return Promise.resolve();
  }
}
