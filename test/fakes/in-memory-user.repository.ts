import type { Actor, Role, UserId } from "@src/shared/domain/actor";
import type { UserRepository } from "@src/shared/domain/user.repository";

/** In-memory UserRepository for unit tests (TST-06). Each entry is a known user with their stored role. */
export class InMemoryUserRepository implements UserRepository {
  private readonly users: readonly Actor[];

  constructor(users: readonly Actor[] = []) {
    this.users = users;
  }

  findRoleById(id: UserId): Promise<Role | undefined> {
    return Promise.resolve(this.users.find((user) => user.id === id)?.role);
  }
}
