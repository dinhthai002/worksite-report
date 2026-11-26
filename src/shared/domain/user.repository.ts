import type { Role, UserId } from "./actor";

/** Looks up the users the system knows. Used by the actor check on every request (research R1). */
export interface UserRepository {
  /** The role stored for the user, or undefined when there is no such user. */
  findRoleById(id: UserId): Promise<Role | undefined>;
}
