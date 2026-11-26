import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";

/** The PRD example's fixed IDs, as loaded by prisma/seed.ts. Shared by the reporting API tests. */
export const LINDA = "00000000-0000-4000-8000-000000000001";
export const MARK = "00000000-0000-4000-8000-000000000002";
export const HENRY = "00000000-0000-4000-8000-000000000003";
export const TOWNHOUSE = "00000000-0000-4000-8000-000000000101";
export const FOUNDATION = "00000000-0000-4000-8000-000000000201";
export const WALLS = "00000000-0000-4000-8000-000000000202";
export const ELECTRICAL = "00000000-0000-4000-8000-000000000203";

export type RoleName = "FOREMAN" | "SITE_SUPERVISOR";

export const FOREMAN: RoleName = "FOREMAN";
export const SITE_SUPERVISOR: RoleName = "SITE_SUPERVISOR";

export interface ItemBody {
  readonly taskId: string;
  readonly reportedProgress: number;
  readonly note?: string | null;
}

export interface SaveBody {
  readonly version?: number;
  readonly note?: string | null;
  readonly items: readonly ItemBody[];
}

/** Requests as one user, each write with a fresh Idempotency-Key unless one is given (API-02). */
export class Caller {
  private readonly app: Express;
  private readonly userId: string;
  private readonly role: RoleName;

  constructor(app: Express, userId: string, role: RoleName) {
    this.app = app;
    this.userId = userId;
    this.role = role;
  }

  saveDraft(worksiteId: string, workDate: string, body: unknown, key: string = randomUUID()): request.Test {
    return this.as(request(this.app).put(`/worksites/${worksiteId}/reports/${workDate}`))
      .set("Idempotency-Key", key)
      .send(body as object);
  }

  submit(reportId: string, body: unknown, key: string = randomUUID()): request.Test {
    return this.as(request(this.app).post(`/reports/${reportId}/submit`))
      .set("Idempotency-Key", key)
      .send(body as object);
  }

  approve(reportId: string, body: unknown, key: string = randomUUID()): request.Test {
    return this.as(request(this.app).post(`/reports/${reportId}/approve`))
      .set("Idempotency-Key", key)
      .send(body as object);
  }

  getReport(reportId: string): request.Test {
    return this.as(request(this.app).get(`/reports/${reportId}`));
  }

  getWorksite(worksiteId: string): request.Test {
    return this.as(request(this.app).get(`/worksites/${worksiteId}`));
  }

  private as(test: request.Test): request.Test {
    return test.set("X-Actor-Id", this.userId).set("X-Actor-Role", this.role);
  }
}
