export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

/** Format a Prisma `date` column as YYYY-MM-DD using its UTC civil parts. */
export function formatDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse YYYY-MM-DD into a Date suitable for Prisma `@db.Date` columns. */
export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid date");
  }
  return date;
}

/** Civil date in Asia/Kuala_Lumpur for an absolute instant. */
export function malaysiaCivilDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MALAYSIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Invalid instant");
  }
  return `${year}-${month}-${day}`;
}

/**
 * Parse an ISO-8601 instant. Values without an offset are rejected so callers
 * must supply Malaysia time explicitly (for example `...+08:00`).
 */
export function parseInstant(value: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid instant");
  }
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("Instant must include a timezone offset");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid instant");
  }
  return date;
}

/** Serialize an instant as ISO-8601 with an explicit numeric offset. */
export function formatInstant(value: Date): string {
  return value.toISOString().replace(/\.(\d{3})?Z$/, "+00:00");
}

export function malaysiaYearMonth(instant: Date): string {
  return malaysiaCivilDate(instant).slice(0, 7);
}

/** Display an instant in Asia/Kuala_Lumpur (hydration-safe fixed timezone). */
export function formatMalaysiaDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: MALAYSIA_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Display a calendar date string YYYY-MM-DD without shifting timezones. */
export function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function shiftYearMonth(value: string, offset: number): string {
  const [yearText, monthText] = value.split("-");
  let year = Number(yearText);
  let month = Number(monthText) + offset;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}
