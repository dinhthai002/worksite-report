export const ROLES = ["FOREMAN", "SITE_SUPERVISOR"] as const;

export type Role = (typeof ROLES)[number];

declare const userIdBrand: unique symbol;

/** ID of a user. Branded so it cannot be mixed up with other IDs (TS-08). */
export type UserId = string & { readonly [userIdBrand]: true };

/** The user making the current request, with their role. */
export interface Actor {
  readonly id: UserId;
  readonly role: Role;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function toUserId(value: string): UserId {
  return value as UserId;
}
