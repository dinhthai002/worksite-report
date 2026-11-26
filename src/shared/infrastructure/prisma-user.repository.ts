import type { UserRole } from "@prisma/client";
import { Role, type UserId } from "../domain/actor";
import { assertNever } from "../domain/assert-never";
import type { UserRepository } from "../domain/user.repository";
import type { DatabaseClient } from "./db";

export class PrismaUserRepository implements UserRepository {
  private readonly client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.client = client;
  }

  async findRoleById(id: UserId): Promise<Role | undefined> {
    const row = await this.client.user.findUnique({ where: { id }, select: { role: true } });
    return row === null ? undefined : toRole(row.role);
  }
}

function toRole(role: UserRole): Role {
  switch (role) {
    case "FOREMAN":
      return Role.FOREMAN;
    case "SITE_SUPERVISOR":
      return Role.SITE_SUPERVISOR;
    default:
      return assertNever(role);
  }
}
