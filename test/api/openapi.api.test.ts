import { randomUUID } from "node:crypto";
import { reportViewSchema } from "@src/modules/reporting";
import { worksiteViewSchema } from "@src/modules/worksite";
import { createPrismaClient } from "@src/shared/infrastructure/db";
import { errorBodySchema } from "@src/shared/infrastructure/http/openapi";
import type { Express } from "express";
import request from "supertest";
import { loadExample } from "../../prisma/seed";
import { truncateAll } from "../support/database";
import { createTestApp } from "../support/test-app";
import { Caller, FOREMAN, LINDA, MARK, SITE_SUPERVISOR, TOWNHOUSE, WALLS } from "../support/townhouse";

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is not set. API tests must run through Jest, which starts PostgreSQL.");
}

/** Served by docs.routes.ts itself, so it is not part of the description. */
const UNDESCRIBED = new Set(["GET /openapi.json"]);

/** An Express router is a function with a `stack` of layers. */
function stackOf(router: unknown): readonly unknown[] {
  const isRouter = typeof router === "function" || (typeof router === "object" && router !== null);
  if (isRouter && "stack" in router && Array.isArray(router.stack)) {
    return router.stack;
  }
  return [];
}

/** Every route the app answers, as `METHOD /path/:param`, read from Express's router. */
function routesOf(router: unknown): string[] {
  const found: string[] = [];
  for (const layer of stackOf(router)) {
    if (typeof layer !== "object" || layer === null) {
      continue;
    }
    // Express 5 gives every layer a `route` key, undefined unless the layer is a route.
    const route: unknown = "route" in layer ? layer.route : undefined;
    if (typeof route === "object" && route !== null) {
      if ("path" in route && typeof route.path === "string" && "methods" in route) {
        const methods = typeof route.methods === "object" && route.methods !== null ? Object.keys(route.methods) : [];
        found.push(...methods.map((method) => `${method.toUpperCase()} ${route.path}`));
      }
    } else if ("handle" in layer) {
      found.push(...routesOf(layer.handle));
    }
  }
  return found;
}

/** GET /openapi.json and /docs (API-05). */
describe("API description", () => {
  const prisma = createPrismaClient(databaseUrl);
  const app: Express = createTestApp(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("serves the OpenAPI document without actor headers", async () => {
    const response = await request(app).get("/openapi.json");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ openapi: "3.1.0", info: { title: "Worksite Report API" } });
  });

  it("serves the Swagger UI at /docs without actor headers", async () => {
    const response = await request(app).get("/docs/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.text).toContain("swagger-ui");
  });

  it("describes exactly the routes the app answers", async () => {
    const response = await request(app).get("/openapi.json");
    const paths = response.body.paths as Record<string, Record<string, unknown>>;
    const described = Object.entries(paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`),
    );

    const answered = routesOf(Reflect.get(app, "router")).filter((route) => !UNDESCRIBED.has(route));

    expect([...described].sort()).toEqual([...answered].sort());
  });

  describe("responses match the described schemas", () => {
    const mark = new Caller(app, MARK, FOREMAN);
    const linda = new Caller(app, LINDA, SITE_SUPERVISOR);

    beforeEach(async () => {
      await truncateAll(prisma);
      await loadExample(prisma, "fill");
    });

    it("WorksiteView, for a site supervisor and a foreman", async () => {
      for (const caller of [linda, mark]) {
        const response = await caller.getWorksite(TOWNHOUSE);

        expect(response.status).toBe(200);
        expect(worksiteViewSchema.safeParse(response.body).error).toBeUndefined();
      }
    });

    it("ReportView, through draft, submit, reject, edit, resubmit, approve and view", async () => {
      const items = [{ taskId: WALLS, reportedProgress: 55 }];
      const created = await mark.saveDraft(TOWNHOUSE, "2026-11-20", { items });
      const reportId: string = created.body.id;
      const responses = [created];
      responses.push(await mark.submit(reportId, { version: 1 }));
      responses.push(await linda.reject(reportId, { version: 2, reason: "walls not plumb" }));
      responses.push(await mark.saveDraft(TOWNHOUSE, "2026-11-20", { version: 3, note: "Rebuilt.", items }));
      responses.push(await mark.submit(reportId, { version: 4 }));
      responses.push(await linda.approve(reportId, { version: 5 }));
      responses.push(await linda.getReport(reportId));

      expect(responses.map((response) => response.status)).toEqual([201, 200, 200, 200, 200, 200, 200]);
      for (const response of responses) {
        expect(reportViewSchema.safeParse(response.body).error).toBeUndefined();
      }
    });

    it("ErrorBody, for a refused request", async () => {
      const response = await linda.getReport(randomUUID());

      expect(response.status).toBe(404);
      expect(errorBodySchema.safeParse(response.body).error).toBeUndefined();
    });
  });
});
