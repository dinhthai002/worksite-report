/**
 * Marks the end of an exhaustive `switch` over a union (TS-06). The compiler rejects the call when a case is
 * missing; at runtime it throws if a value outside the union arrives anyway, for example from stored data.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
