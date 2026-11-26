import { z } from "zod";
import { ROLES } from "../../domain/actor";

/**
 * The OpenAPI 3.1 description of the HTTP API, served by docs.routes.ts. Each module describes its own endpoints in
 * its `interface/*.openapi.ts` (API-05); app.ts joins them with buildOpenApiDocument. Request schemas are generated
 * from the Zod schemas the routes validate with, so the description cannot drift from what is accepted.
 */

/** A JSON Schema object, as OpenAPI 3.1 embeds it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export type HttpMethod = "get" | "put" | "post";

export interface OpenApiParameter {
  readonly name: string;
  readonly in: "path" | "header";
  readonly required: boolean;
  readonly description?: string;
  readonly schema: JsonSchema;
}

export interface OpenApiMediaType {
  readonly schema: JsonSchema;
  readonly example?: unknown;
}

export interface OpenApiResponse {
  readonly description: string;
  readonly content?: Readonly<Record<string, OpenApiMediaType>>;
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly security: readonly Readonly<Record<string, readonly string[]>>[];
  readonly parameters: readonly OpenApiParameter[];
  readonly requestBody?: { readonly required: boolean; readonly content: Readonly<Record<string, OpenApiMediaType>> };
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
}

export type OpenApiPaths = Readonly<Record<string, Readonly<Partial<Record<HttpMethod, OpenApiOperation>>>>>;

/** What one module contributes to the document: a tag, its paths, and the response schemas they refer to. */
export interface OpenApiModule {
  readonly tag: { readonly name: string; readonly description: string };
  readonly paths: OpenApiPaths;
  readonly schemas: Readonly<Record<string, JsonSchema>>;
}

export type OpenApiDocument = {
  readonly openapi: "3.1.0";
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly tags: readonly { readonly name: string; readonly description: string }[];
  readonly paths: OpenApiPaths;
  readonly components: {
    readonly schemas: Readonly<Record<string, JsonSchema>>;
    readonly securitySchemes: Readonly<Record<string, Readonly<Record<string, string>>>>;
  };
};

/** JSON Schema for a Zod schema, without the `$schema` key that OpenAPI does not want on embedded schemas. */
export function jsonSchema(schema: z.ZodType, io: "input" | "output" = "input"): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io });
  return rest;
}

/** OpenAPI's reference keyword, which is not a camelCase name (NAM-02). */
const REF = "$ref";

/** A reference to a schema in `components.schemas`. */
export function schemaRef(name: string): JsonSchema {
  return { [REF]: `#/components/schemas/${name}` };
}

/** One path parameter per property of the route's Zod params schema. */
export function pathParameters(schema: z.ZodObject): OpenApiParameter[] {
  return Object.entries(schema.shape).map(
    ([name, property]): OpenApiParameter => ({ name, in: "path", required: true, schema: jsonSchema(property) }),
  );
}

/** The error shape every error response uses (architecture.md section 4.2, API-03). */
export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.string().meta({ description: "Stable, UPPER_SNAKE_CASE error code (NAM-07)" }),
    message: z.string().meta({ description: "What went wrong and how to fix it" }),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const ERROR_BODY = "ErrorBody";

/** An error code and when it is returned, rendered as one line of the response's description. */
export type ErrorCase = readonly [code: string, when: string];

export type ErrorStatus = "400" | "401" | "403" | "404" | "409" | "422" | "500" | "503";

function errorResponse(cases: readonly ErrorCase[]): OpenApiResponse {
  return {
    description: cases.map(([code, when]) => `- \`${code}\`: ${when}`).join("\n"),
    content: { "application/json": { schema: schemaRef(ERROR_BODY) } },
  };
}

/** Error cases from several sources, one response per status, in status order. */
function mergeErrors(
  ...groups: Readonly<Partial<Record<ErrorStatus, readonly ErrorCase[]>>>[]
): (OpenApiResponse & { readonly status: string })[] {
  const byStatus = new Map<string, ErrorCase[]>();
  for (const group of groups) {
    for (const [status, cases] of Object.entries(group)) {
      byStatus.set(status, [...(byStatus.get(status) ?? []), ...cases]);
    }
  }
  return [...byStatus.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, cases]) => ({ ...errorResponse(cases), status }));
}

const ACTOR_SECURITY = [{ actorId: [], actorRole: [] }] as const;

const IDEMPOTENCY_KEY_PARAMETER: OpenApiParameter = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description:
    "1 to 255 visible ASCII characters, new for each action (BR-14, API-02). Repeating a request with the same key returns the stored response; a UUID is a good choice.",
  schema: { type: "string", pattern: "^[\\x21-\\x7E]{1,255}$" },
};

export interface SuccessResponse {
  readonly description: string;
  readonly schema: JsonSchema;
  readonly example?: unknown;
}

export interface OperationSpec {
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tag: string;
  readonly params?: z.ZodObject;
  /** The route's Zod body schema. A POST or PUT always carries one, and an Idempotency-Key. */
  readonly body?: { readonly schema: z.ZodType; readonly example?: unknown };
  readonly success: Readonly<Record<string, SuccessResponse>>;
  readonly errors: Readonly<Partial<Record<ErrorStatus, readonly ErrorCase[]>>>;
}

/**
 * One operation, with what every operation shares added: the actor headers, the Idempotency-Key on a write, and the
 * errors that the request handling returns before the route runs (contracts identity.md and idempotency.md).
 */
export function operation(spec: OperationSpec): OpenApiOperation {
  const writes = spec.body !== undefined;
  const common: Partial<Record<ErrorStatus, readonly ErrorCase[]>> = {
    "400": [
      [
        "VALIDATION_FAILED",
        writes
          ? "the path, query, Idempotency-Key or body does not match the schema; `details.issues` lists each problem"
          : "the path or query does not match the schema, or a body is sent; `details.issues` lists each problem",
      ],
      ...(writes ? [["MALFORMED_JSON", "the body is not valid JSON"] as const] : []),
    ],
    "401": [["UNAUTHENTICATED", "`X-Actor-Id` or `X-Actor-Role` is missing, invalid, unknown, or not the user's role"]],
    "500": [["INTERNAL_ERROR", "an unexpected error; details are in the server log only"]],
  };
  const idempotency: Partial<Record<ErrorStatus, readonly ErrorCase[]>> = writes
    ? {
        "409": [["IDEMPOTENCY_KEY_IN_PROGRESS", "the first request with this key is still running (BR-14)"]],
        "422": [["IDEMPOTENCY_KEY_REUSED", "this key was already used for a different request (BR-14)"]],
      }
    : {};

  const responses: Record<string, OpenApiResponse> = {};
  for (const [status, success] of Object.entries(spec.success)) {
    responses[status] = {
      description: success.description,
      content: {
        "application/json":
          success.example === undefined
            ? { schema: success.schema }
            : { schema: success.schema, example: success.example },
      },
    };
  }
  for (const { status, ...response } of mergeErrors(common, idempotency, spec.errors)) {
    responses[status] = response;
  }

  return {
    operationId: spec.operationId,
    summary: spec.summary,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    tags: [spec.tag],
    security: ACTOR_SECURITY,
    parameters: [
      ...(spec.params === undefined ? [] : pathParameters(spec.params)),
      ...(writes ? [IDEMPOTENCY_KEY_PARAMETER] : []),
    ],
    ...(spec.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              "application/json":
                spec.body.example === undefined
                  ? { schema: jsonSchema(spec.body.schema) }
                  : { schema: jsonSchema(spec.body.schema), example: spec.body.example },
            },
          },
        }),
    responses,
  };
}

const HEALTH_PATHS: OpenApiPaths = {
  "/health": {
    get: {
      operationId: "getHealth",
      summary: "Liveness and database check",
      description: "Needs no actor headers.",
      tags: ["System"],
      security: [],
      parameters: [],
      responses: {
        "200": {
          description: "The server is up and the database answers.",
          content: {
            "application/json": {
              schema: jsonSchema(z.strictObject({ status: z.literal("ok") })),
              example: { status: "ok" },
            },
          },
        },
        ...Object.fromEntries(
          mergeErrors({ "503": [["DATABASE_UNAVAILABLE", "the database does not answer"]] }).map(
            ({ status, ...response }) => [status, response],
          ),
        ),
      },
    },
  },
};

const ACTOR_DESCRIPTION =
  "There is no authentication: the caller states who they are in headers, and the user and role must match a known user. With the example data: Linda `00000000-0000-4000-8000-000000000001` (SITE_SUPERVISOR), Mark `00000000-0000-4000-8000-000000000002` (FOREMAN), Henry `00000000-0000-4000-8000-000000000003` (FOREMAN).";

/** Joins the modules' descriptions into one document. A path described by two modules is a wiring mistake. */
export function buildOpenApiDocument(modules: readonly OpenApiModule[]): OpenApiDocument {
  const paths: Record<string, OpenApiPaths[string]> = { ...HEALTH_PATHS };
  const schemas: Record<string, JsonSchema> = { [ERROR_BODY]: jsonSchema(errorBodySchema, "output") };
  for (const module of modules) {
    for (const [path, operations] of Object.entries(module.paths)) {
      if (path in paths) {
        throw new Error(`OpenAPI path ${path} is described twice`);
      }
      paths[path] = operations;
    }
    for (const [name, schema] of Object.entries(module.schemas)) {
      if (name in schemas) {
        throw new Error(`OpenAPI schema ${name} is described twice`);
      }
      schemas[name] = schema;
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Worksite Report API",
      version: "1.0.0",
      description: `Foremen report task progress in daily reports; the site supervisor approves or rejects them. ${ACTOR_DESCRIPTION} Use **Authorize** to set both headers once.`,
    },
    tags: [{ name: "System", description: "Operations of the server itself" }, ...modules.map((module) => module.tag)],
    paths,
    components: {
      schemas,
      securitySchemes: {
        actorId: {
          type: "apiKey",
          in: "header",
          name: "X-Actor-Id",
          description: `UUID of a known user. ${ACTOR_DESCRIPTION}`,
        },
        actorRole: {
          type: "apiKey",
          in: "header",
          name: "X-Actor-Role",
          description: `The user's stored role, exact case: ${ROLES.join(" or ")}.`,
        },
      },
    },
  };
}
