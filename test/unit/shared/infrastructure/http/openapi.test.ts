import {
  buildOpenApiDocument,
  jsonSchema,
  type OpenApiModule,
  operation,
} from "@src/shared/infrastructure/http/openapi";
import { z } from "zod";

const params = z.object({ thingId: z.uuid() });

function moduleWith(path: string, schemaName = "ThingView"): OpenApiModule {
  return {
    tag: { name: "Things", description: "Things" },
    schemas: { [schemaName]: { type: "object" } },
    paths: {
      [path]: {
        get: operation({
          operationId: "getThing",
          summary: "View a thing",
          tag: "Things",
          params,
          success: { "200": { description: "The thing.", schema: { type: "object" } } },
          errors: { "404": [["THING_NOT_FOUND", "no thing has this ID"]] },
        }),
      },
    },
  };
}

describe("jsonSchema", () => {
  it("leaves out the $schema dialect, which OpenAPI does not want on embedded schemas", () => {
    const schema = jsonSchema(z.strictObject({ version: z.number().int().min(1) }));

    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ type: "object", required: ["version"], additionalProperties: false });
  });
});

describe("operation", () => {
  it("documents a read with its path parameters, the actor headers and the errors every request can get", () => {
    const read = moduleWith("/things/{thingId}").paths["/things/{thingId}"]?.get;

    expect(read?.parameters).toEqual([expect.objectContaining({ name: "thingId", in: "path", required: true })]);
    expect(read?.security).toEqual([{ actorId: [], actorRole: [] }]);
    expect(Object.keys(read?.responses ?? {})).toEqual(["200", "400", "401", "404", "500"]);
    expect(read?.requestBody).toBeUndefined();
  });

  it("BR-14 documents a write with a required Idempotency-Key and the request key errors", () => {
    const write = operation({
      operationId: "renameThing",
      summary: "Rename a thing",
      tag: "Things",
      params,
      body: { schema: z.strictObject({ name: z.string() }), example: { name: "New name" } },
      success: { "200": { description: "The thing.", schema: { type: "object" } } },
      errors: { "409": [["THING_LOCKED", "the thing is locked"]] },
    });

    expect(write.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: true }));
    expect(write.requestBody?.content["application/json"]?.example).toEqual({ name: "New name" });
    expect(write.responses["409"]?.description).toBe(
      "- `IDEMPOTENCY_KEY_IN_PROGRESS`: the first request with this key is still running (BR-14)\n- `THING_LOCKED`: the thing is locked",
    );
    expect(write.responses["422"]?.description).toContain("IDEMPOTENCY_KEY_REUSED");
    expect(write.responses["400"]?.description).toContain("MALFORMED_JSON");
  });
});

describe("buildOpenApiDocument", () => {
  it("joins the modules' paths, tags and schemas with GET /health and the error shape", () => {
    const document = buildOpenApiDocument([moduleWith("/things/{thingId}")]);

    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toEqual(["/health", "/things/{thingId}"]);
    expect(document.tags.map((tag) => tag.name)).toEqual(["System", "Things"]);
    expect(Object.keys(document.components.schemas)).toEqual(["ErrorBody", "ThingView"]);
    expect(document.paths["/health"]?.get?.security).toEqual([]);
  });

  it("refuses a path that two modules describe", () => {
    expect(() =>
      buildOpenApiDocument([moduleWith("/things/{thingId}", "A"), moduleWith("/things/{thingId}", "B")]),
    ).toThrow("OpenAPI path /things/{thingId} is described twice");
  });

  it("refuses a schema name that two modules use", () => {
    expect(() => buildOpenApiDocument([moduleWith("/a/{thingId}"), moduleWith("/b/{thingId}")])).toThrow(
      "OpenAPI schema ThingView is described twice",
    );
  });
});
