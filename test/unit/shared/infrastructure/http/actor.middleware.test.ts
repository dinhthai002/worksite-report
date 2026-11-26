import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { currentActor, readActor, UnauthenticatedError } from "@src/shared/infrastructure/http/actor.middleware";

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
    ["both headers are missing", {}],
    ["the role is missing", { "x-actor-id": ACTOR_ID }],
    ["the id is missing", { "x-actor-role": "FOREMAN" }],
    ["the id is not a UUID", { "x-actor-id": "minh", "x-actor-role": "FOREMAN" }],
    ["the role is unknown", { "x-actor-id": ACTOR_ID, "x-actor-role": "PROJECT_MANAGER" }],
  ])("rejects the request when %s", (_case, values) => {
    expect(() => readActor(headers(values))).toThrow(UnauthenticatedError);
  });
});
