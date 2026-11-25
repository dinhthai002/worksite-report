/**
 * The only way domain and application code read the current time (ARC-10).
 *
 * The application's time zone lives in the implementation, not in the domain: `today()` returns the
 * calendar date already resolved in that zone, so rules such as BR-2 compare calendar dates only.
 */
export interface Clock {
  now(): Date;

  /** Today's calendar date in the application's time zone, formatted `YYYY-MM-DD`. */
  today(): string;
}
