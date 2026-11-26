import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { UserId } from "../../domain/actor";
import { ConflictError, RuleViolationError } from "../../domain/errors";
import { currentActor } from "./actor.middleware";

/** A stored claim: in progress while responseStatus is null, completed otherwise. */
export interface StoredKey {
  readonly requestHash: string;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
}

/**
 * Storage for request keys, per actor and key (BR-14). Declared here, its only user: idempotency is an HTTP concern,
 * not a domain one (research R9, R19).
 */
export interface IdempotencyKeyRepository {
  /** Inserts an in-progress claim. False when the actor already has this key. */
  claim(actorId: UserId, key: string, requestHash: string): Promise<boolean>;
  find(actorId: UserId, key: string): Promise<StoredKey | undefined>;
  complete(actorId: UserId, key: string, status: number, body: unknown): Promise<void>;
  /** Deletes an in-progress claim, so the request can be sent again. A completed one is kept. */
  release(actorId: UserId, key: string): Promise<void>;
}

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

const KEY_MESSAGE = "Send an Idempotency-Key header: 1 to 255 visible ASCII characters, new for each action.";

const keyHeaders = z.object({
  headers: z.object({
    // One pattern for presence, length and characters, so a bad key gives exactly one issue.
    [IDEMPOTENCY_KEY_HEADER]: z.string({ error: KEY_MESSAGE }).regex(/^[\x21-\x7E]{1,255}$/, KEY_MESSAGE),
  }),
});

/** The request key, or a ZodError with the issue path `headers.idempotency-key` (a 400). */
export function readIdempotencyKey(header: string | undefined): string {
  return keyHeaders.parse({ headers: { [IDEMPOTENCY_KEY_HEADER]: header } }).headers[IDEMPOTENCY_KEY_HEADER];
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** JSON with object keys sorted at every level, so `{a,b}` and `{b,a}` are the same request. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** The fingerprint of "the same request": method, URL and body. A request with no body hashes as null. */
export function requestHash(method: string, url: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method}\n${url}\n${canonicalJson(body ?? null)}`)
    .digest("hex");
}

export type Begin =
  | { readonly kind: "run" }
  | { readonly kind: "replay"; readonly status: number; readonly body: unknown };

/**
 * BR-14, claim first (research R9): a first use runs; a completed repeat replays; a repeat still running is told so;
 * a reused key with different content is refused.
 */
export async function beginRequest(
  keys: IdempotencyKeyRepository,
  actorId: UserId,
  key: string,
  hash: string,
): Promise<Begin> {
  if (await keys.claim(actorId, key, hash)) {
    return { kind: "run" };
  }
  const stored = await keys.find(actorId, key);
  if (stored !== undefined && stored.requestHash !== hash) {
    throw new RuleViolationError(
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used for a different request. Use a new key.",
    );
  }
  // Undefined means the first request released its key between our claim and find: it is still settling.
  if (stored === undefined || stored.responseStatus === null) {
    throw new ConflictError(
      "IDEMPOTENCY_KEY_IN_PROGRESS",
      "The original request with this Idempotency-Key is still being processed. Retry it later.",
    );
  }
  return { kind: "replay", status: stored.responseStatus, body: stored.responseBody };
}

/** FR-026: a success is stored with its key; anything else releases the key, so a retry runs afresh. */
export async function finishRequest(
  keys: IdempotencyKeyRepository,
  actorId: UserId,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (status < 400) {
    await keys.complete(actorId, key, status, body);
  } else {
    await keys.release(actorId, key);
  }
}

/**
 * BR-14 for every POST and PUT (API-02). Mounted after the actor middleware (architecture.md section 6, step 3).
 * The response is sent only after it is stored, so a client that retries as soon as it has an answer never finds its
 * key still in progress.
 */
export function idempotencyMiddleware(keys: IdempotencyKeyRepository): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== "POST" && req.method !== "PUT") {
      next();
      return;
    }
    let key: string;
    let begin: Begin;
    const actorId = currentActor(res).id;
    try {
      key = readIdempotencyKey(req.get(IDEMPOTENCY_KEY_HEADER));
      begin = await beginRequest(keys, actorId, key, requestHash(req.method, req.originalUrl, req.body));
    } catch (error) {
      next(error);
      return;
    }
    if (begin.kind === "replay") {
      res.status(begin.status).json(begin.body);
      return;
    }
    const send = res.json.bind(res);
    res.json = (body?: unknown): Response => {
      // Restore first, so the error handler's own response cannot loop back here.
      res.json = send;
      finishRequest(keys, actorId, key, res.statusCode, body).then(
        () => send(body),
        (error: unknown) => next(error),
      );
      return res;
    };
    next();
  };
}
