import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { type Actor, ROLES, toUserId } from "../../domain/actor";
import type { UserRepository } from "../../domain/user.repository";

declare global {
  namespace Express {
    interface Locals {
      actor?: Actor;
    }
  }
}

export const ACTOR_ID_HEADER = "x-actor-id";
export const ACTOR_ROLE_HEADER = "x-actor-role";

/** Why a request was refused as unauthenticated. Logged for operators, never returned to the caller (FR-005a). */
export type UnauthenticatedReason = "HEADERS_MISSING" | "HEADERS_MALFORMED" | "UNKNOWN_USER" | "ROLE_MISMATCH";

/** One message for every reason, so a caller cannot tell whether an ID belongs to a user (FR-005). */
export const UNAUTHENTICATED_MESSAGE =
  "Send X-Actor-Id as the UUID of a known user and X-Actor-Role as that user's role: FOREMAN or SITE_SUPERVISOR.";

/** The caller's identity is missing, invalid, or unknown. A transport concern, so it is not a DomainError. */
export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";
  readonly reason: UnauthenticatedReason;

  constructor(reason: UnauthenticatedReason) {
    super(UNAUTHENTICATED_MESSAGE);
    this.name = "UnauthenticatedError";
    this.reason = reason;
  }
}

const actorHeadersSchema = z.object({
  id: z.uuid(),
  role: z.enum(ROLES),
});

/**
 * Reads the actor from the X-Actor-Id and X-Actor-Role headers (architecture.md section 4.1).
 * Throws UnauthenticatedError when either is missing or invalid. Roles match exactly, so `foreman` is invalid.
 */
export function readActor(header: (name: string) => string | undefined): Actor {
  const id = header(ACTOR_ID_HEADER);
  const role = header(ACTOR_ROLE_HEADER);
  if (id === undefined || role === undefined) {
    throw new UnauthenticatedError("HEADERS_MISSING");
  }
  const parsed = actorHeadersSchema.safeParse({ id, role });
  if (!parsed.success) {
    throw new UnauthenticatedError("HEADERS_MALFORMED");
  }
  return { id: toUserId(parsed.data.id), role: parsed.data.role };
}

/**
 * Reads the actor and checks it against the known users: the user must exist and the stated role must be the
 * stored one (FR-001 to FR-004). Throws UnauthenticatedError otherwise.
 */
export async function authenticate(
  header: (name: string) => string | undefined,
  users: UserRepository,
): Promise<Actor> {
  const actor = readActor(header);
  const storedRole = await users.findRoleById(actor.id);
  if (storedRole === undefined) {
    throw new UnauthenticatedError("UNKNOWN_USER");
  }
  if (storedRole !== actor.role) {
    throw new UnauthenticatedError("ROLE_MISMATCH");
  }
  return actor;
}

/**
 * The actor that actorMiddleware stored for this request. Route handlers call it to pass the actor to a use case.
 * Throws a plain Error (a 500) if the route was mounted before actorMiddleware: a wiring mistake, not a client one.
 */
export function currentActor(res: Pick<Response, "locals">): Actor {
  const actor = res.locals.actor;
  if (actor === undefined) {
    throw new Error("currentActor called before actorMiddleware");
  }
  return actor;
}

/** Stores the checked actor in `res.locals.actor`, or passes UnauthenticatedError to the error handler. */
export function actorMiddleware(users: UserRepository): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let actor: Actor;
    try {
      actor = await authenticate((name: string) => req.get(name), users);
    } catch (error) {
      next(error);
      return;
    }
    res.locals.actor = actor;
    next();
  };
}
