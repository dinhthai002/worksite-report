import type { Clock } from "../domain/clock";

/** The calendar date (`YYYY-MM-DD`) of an instant, as seen in the given IANA time zone. */
export function calendarDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The real clock. The time zone comes from APP_TIME_ZONE (BR-2). */
export class SystemClock implements Clock {
  private readonly timeZone: string;

  constructor(timeZone: string) {
    this.timeZone = timeZone;
  }

  now(): Date {
    return new Date();
  }

  today(): string {
    return calendarDateIn(this.now(), this.timeZone);
  }
}
