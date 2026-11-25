import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { type Actor, ROLES, toUserId } from "../../domain/actor";

declare global {
  namespace Express {
    interface Locals {
      actor?: Actor;
    }
  }
}

export const ACTOR_ID_HEADER = "x-actor-id";
export const ACTOR_ROLE_HEADER = "x-actor-role";

/** The caller's identity is missing or invalid. A transport concern, so it is not a DomainError. */
export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";

  constructor(message: string) {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

const actorHeadersSchema = z.object({
  id: z.uuid(),
  role: z.enum(ROLES),
});

/**
 * Reads the actor from the X-Actor-Id and X-Actor-Role headers (architecture.md section 5.1).
 * Throws UnauthenticatedError when either is missing or invalid.
 */
export function readActor(header: (name: string) => string | undefined): Actor {
  const parsed = actorHeadersSchema.safeParse({ id: header(ACTOR_ID_HEADER), role: header(ACTOR_ROLE_HEADER) });
  if (!parsed.success) {
    throw new UnauthenticatedError(
      `Send ${ACTOR_ID_HEADER} as a UUID and ${ACTOR_ROLE_HEADER} as one of: ${ROLES.join(", ")}.`,
    );
  }
  return { id: toUserId(parsed.data.id), role: parsed.data.role };
}

/** Stores the actor in `res.locals.actor`, or passes UnauthenticatedError to the error handler. */
export function actorMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.locals.actor = readActor((name: string) => req.get(name));
      next();
    } catch (error) {
      next(error);
    }
  };
}
