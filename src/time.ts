/**
 * Datetimes are stored the way Laravel stores them, `Y-m-d H:i:s` in UTC, so a
 * SQLite file written by a Laravel app and by this package reads the same, and
 * a range is a string comparison. Rendered as Carbon's `toIso8601String()`.
 *
 * Periods (today, this week, this month, this year) are computed in UTC, as
 * the reference does with Laravel's default `app.timezone`.
 */

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** A Date as a stored datetime: `2026-11-18 12:00:00`. */
export function toDb(d: Date): string {
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** A stored datetime as ISO 8601 with an explicit offset: `2026-11-18T12:00:00+00:00`. */
export function toIso(db: string | null | undefined): string | null {
  if (db === null || db === undefined) return null;
  return `${db.replace(" ", "T")}+00:00`;
}

/** Parse what a caller passes as a bound: a Date or anything `new Date()` reads. */
export function toDate(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Not a date: ${String(value)}`);
  return d;
}

export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Monday 00:00, as Carbon's startOfWeek() with its default Monday start. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - back * 86_400_000);
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function startOfYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}
