import type { Clock } from "@src/shared/domain/clock";
import { calendarDateIn } from "@src/shared/infrastructure/system-clock";

/** A Clock that always returns the same instant (TST-05). No test depends on the real date. */
export class FixedClock implements Clock {
  private instant: Date;
  private readonly timeZone: string;

  constructor(instant: Date | string, timeZone = "Asia/Ho_Chi_Minh") {
    this.instant = new Date(instant);
    this.timeZone = timeZone;
  }

  now(): Date {
    return new Date(this.instant.getTime());
  }

  today(): string {
    return calendarDateIn(this.instant, this.timeZone);
  }

  /** Moves the clock to another instant, for tests that cross a date boundary. */
  setTo(instant: Date | string): void {
    this.instant = new Date(instant);
  }
}
