import type { WorksiteId } from "../../../shared/domain/ids";
import type { DatabaseClient } from "../../../shared/infrastructure/db";
import type { Worksite } from "../domain/worksite";
import type { WorksiteRepository } from "../domain/worksite.repository";
import { toWorksite } from "./worksite.mapper";

export class PrismaWorksiteRepository implements WorksiteRepository {
  private readonly client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.client = client;
  }

  async findById(id: WorksiteId): Promise<Worksite | undefined> {
    const row = await this.client.worksite.findUnique({
      where: { id },
      // FR-010: last changed first; ties by creation time, then ID, so the order never varies.
      include: { tasks: { orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }, { id: "asc" }] } },
    });
    return row === null ? undefined : toWorksite(row);
  }
}
