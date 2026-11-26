import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import {
  authenticate,
  currentActor,
  readActor,
  UNAUTHENTICATED_MESSAGE,
  UnauthenticatedError,
} from "@src/shared/infrastructure/http/actor.middleware";
import { InMemoryUserRepository } from "../../../../fakes/in-memory-user.repository";

describe("currentActor", () => {
  it("returns the actor stored by actorMiddleware", () => {
    const actor: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };

    expect(currentActor({ locals: { actor } })).toBe(actor);
  });

  it("throws when no actor was stored, because the route is mounted before actorMiddleware", () => {
    expect(() => currentActor({ locals: {} })).toThrow("currentActor called before actorMiddleware");
  });
});

const ACTOR_ID = "7f8c1a52-3a4e-4a0e-9d55-0d8f9f6a2b11";

function headers(values: Record<string, string>): (name: string) => string | undefined {
  return (name: string) => values[name];
}

describe("readActor", () => {
  it.each(["FOREMAN", "SITE_SUPERVISOR"])("reads an actor with role %s", (role) => {
    const actor = readActor(headers({ "x-actor-id": ACTOR_ID, "x-actor-role": role }));

    expect(actor).toEqual({ id: ACTOR_ID, role });
  });

  it.each([
    ["both headers are missing", {}, "HEADERS_MISSING"],
    ["the role is missing", { "x-actor-id": ACTOR_ID }, "HEADERS_MISSING"],
    ["the id is missing", { "x-actor-role": "FOREMAN" }, "HEADERS_MISSING"],
    ["the id is not a UUID", { "x-actor-id": "mark", "x-actor-role": "FOREMAN" }, "HEADERS_MALFORMED"],
    ["the role is unknown", { "x-actor-id": ACTOR_ID, "x-actor-role": "PROJECT_MANAGER" }, "HEADERS_MALFORMED"],
    ["the role is in the wrong case", { "x-actor-id": ACTOR_ID, "x-actor-role": "foreman" }, "HEADERS_MALFORMED"],
  ])("rejects the request when %s, with reason %s", (_case, values, reason) => {
    expect(() => readActor(headers(values))).toThrow(expect.objectContaining({ reason }));
    expect(() => readActor(headers(values))).toThrow(UnauthenticatedError);
  });
});

describe("authenticate (FR-001 to FR-005)", () => {
  const linda: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };
  const mark: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
  const users = new InMemoryUserRepository([linda, mark]);

  async function failure(values: Record<string, string>): Promise<UnauthenticatedError> {
    try {
      await authenticate(headers(values), users);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return error;
      }
      throw error;
    }
    throw new Error("expected authenticate to reject");
  }

  it("accepts a known user acting in their stored role", async () => {
    await expect(authenticate(headers({ "x-actor-id": mark.id, "x-actor-role": "FOREMAN" }), users)).resolves.toEqual(
      mark,
    );
  });

  it("rejects an unknown user with reason UNKNOWN_USER", async () => {
    const error = await failure({ "x-actor-id": ACTOR_ID, "x-actor-role": "FOREMAN" });

    expect(error.reason).toBe("UNKNOWN_USER");
  });

  it.each([
    ["a foreman claiming SITE_SUPERVISOR", mark.id, "SITE_SUPERVISOR"],
    ["a site supervisor claiming FOREMAN", linda.id, "FOREMAN"],
  ])("rejects %s with reason ROLE_MISMATCH", async (_case, id, role) => {
    const error = await failure({ "x-actor-id": id, "x-actor-role": role });

    expect(error.reason).toBe("ROLE_MISMATCH");
  });

  it("gives an unknown user and a role mismatch the same code and message (FR-005)", async () => {
    const unknown = await failure({ "x-actor-id": ACTOR_ID, "x-actor-role": "FOREMAN" });
    const mismatch = await failure({ "x-actor-id": mark.id, "x-actor-role": "SITE_SUPERVISOR" });

    expect([unknown.code, unknown.message]).toEqual([mismatch.code, mismatch.message]);
    expect(unknown.message).toBe(UNAUTHENTICATED_MESSAGE);
  });
});
