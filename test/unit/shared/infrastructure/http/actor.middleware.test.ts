import { readActor, UnauthenticatedError } from "@src/shared/infrastructure/http/actor.middleware";

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
