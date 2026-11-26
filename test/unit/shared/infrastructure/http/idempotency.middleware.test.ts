import { toUserId } from "@src/shared/domain/actor";
import { ConflictError, RuleViolationError } from "@src/shared/domain/errors";
import {
  beginRequest,
  canonicalJson,
  finishRequest,
  readIdempotencyKey,
  requestHash,
} from "@src/shared/infrastructure/http/idempotency.middleware";
import { ZodError } from "zod";
import { InMemoryIdempotencyKeyRepository } from "../../../../fakes/in-memory-idempotency-key.repository";

const MARK = toUserId("00000000-0000-4000-8000-000000000002");
const HENRY = toUserId("00000000-0000-4000-8000-000000000003");
const HASH_A = requestHash("PUT", "/worksites/w/reports/2026-11-20", { items: [] });
const HASH_B = requestHash("PUT", "/worksites/w/reports/2026-11-20", { items: [], note: "other" });

// The Express glue (mounting, wrapping res.json) is covered end to end by test/api/idempotency.api.test.ts.
describe("idempotency middleware", () => {
  describe("readIdempotencyKey", () => {
    it("returns a well-formed key", () => {
      expect(readIdempotencyKey("3f2b9c1e-key")).toBe("3f2b9c1e-key");
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["256 characters long", "k".repeat(256)],
      ["containing a space", "two words"],
    ])("refuses a key that is %s, with the path headers.idempotency-key", (_case, header) => {
      expect(() => readIdempotencyKey(header)).toThrow(ZodError);
      try {
        readIdempotencyKey(header);
      } catch (error) {
        expect((error as ZodError).issues.map((issue) => issue.path.join("."))).toEqual(["headers.idempotency-key"]);
      }
    });
  });

  describe("requestHash", () => {
    it("is the same whatever the order of object keys", () => {
      expect(canonicalJson({ a: 1, b: { d: [{ f: 1, e: 2 }], c: 3 } })).toBe(
        canonicalJson({ b: { c: 3, d: [{ e: 2, f: 1 }] }, a: 1 }),
      );
      expect(requestHash("PUT", "/x", { a: 1, b: 2 })).toBe(requestHash("PUT", "/x", { b: 2, a: 1 }));
    });

    it("differs for another method, URL or body", () => {
      const hashes = [
        requestHash("PUT", "/x", { a: 1 }),
        requestHash("POST", "/x", { a: 1 }),
        requestHash("PUT", "/y", { a: 1 }),
        requestHash("PUT", "/x", { a: 2 }),
      ];

      expect(new Set(hashes).size).toBe(4);
    });

    it("hashes a missing body as null", () => {
      expect(requestHash("POST", "/x", undefined)).toBe(requestHash("POST", "/x", null));
    });
  });

  describe("beginRequest and finishRequest", () => {
    it("BR-14 lets a first request run and stores its response", async () => {
      const keys = new InMemoryIdempotencyKeyRepository();

      const begin = await beginRequest(keys, MARK, "k1", HASH_A);
      await finishRequest(keys, MARK, "k1", 201, { id: "r1" });

      expect(begin).toEqual({ kind: "run" });
      expect(await keys.find(MARK, "k1")).toEqual({
        requestHash: HASH_A,
        responseStatus: 201,
        responseBody: { id: "r1" },
      });
    });

    it("BR-14 replays a completed request", async () => {
      const keys = new InMemoryIdempotencyKeyRepository();
      await beginRequest(keys, MARK, "k1", HASH_A);
      await finishRequest(keys, MARK, "k1", 201, { id: "r1" });

      const again = await beginRequest(keys, MARK, "k1", HASH_A);

      expect(again).toEqual({ kind: "replay", status: 201, body: { id: "r1" } });
    });

    it("BR-14 rejects a reused key with a different body", async () => {
      const keys = new InMemoryIdempotencyKeyRepository();
      await beginRequest(keys, MARK, "k1", HASH_A);
      await finishRequest(keys, MARK, "k1", 201, { id: "r1" });

      const reused = beginRequest(keys, MARK, "k1", HASH_B);

      await expect(reused).rejects.toThrow(RuleViolationError);
      await expect(reused).rejects.toThrow(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }));
    });

    it("BR-14 reports a key still in progress", async () => {
      const keys = new InMemoryIdempotencyKeyRepository();
      await beginRequest(keys, MARK, "k1", HASH_A);

      const duplicate = beginRequest(keys, MARK, "k1", HASH_A);

      await expect(duplicate).rejects.toThrow(ConflictError);
      await expect(duplicate).rejects.toThrow(expect.objectContaining({ code: "IDEMPOTENCY_KEY_IN_PROGRESS" }));
    });

    it.each([400, 422, 500])("releases the key after a %i, so a retry runs", async (status) => {
      const keys = new InMemoryIdempotencyKeyRepository();
      await beginRequest(keys, MARK, "k1", HASH_A);

      await finishRequest(keys, MARK, "k1", status, { error: {} });

      expect(await keys.find(MARK, "k1")).toBeUndefined();
      expect(await beginRequest(keys, MARK, "k1", HASH_A)).toEqual({ kind: "run" });
    });

    it("BR-14 keys belong to their actor: the same key from two actors runs twice", async () => {
      const keys = new InMemoryIdempotencyKeyRepository();
      await beginRequest(keys, MARK, "k1", HASH_A);
      await finishRequest(keys, MARK, "k1", 201, { id: "r1" });

      expect(await beginRequest(keys, HENRY, "k1", HASH_A)).toEqual({ kind: "run" });
    });
  });
});
