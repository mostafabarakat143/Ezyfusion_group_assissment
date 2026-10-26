/**
 * Pure billing calculations for Malaysian ringgit leases.
 * No I/O and no dependence on the host machine timezone.
 *
 * Spec: TASK.md section 3.
 */

export type InvoiceKind = "deposit" | "rent";

export interface ScheduledInvoice {
  kind: InvoiceKind;
  /** 0, 1, 2... for rent; null for the deposit. */
  periodIndex: number | null;
  /** YYYY-MM-DD; null for the deposit. */
  periodStart: string | null;
  /** YYYY-MM-DD, inclusive; null for the deposit. */
  periodEnd: string | null;
  /** YYYY-MM-DD */
  dueDate: string;
  /** Integer sen. */
  amountSen: number;
}

export type InvoiceStatus = "paid" | "partially_paid" | "unpaid" | "overdue";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

/**
 * Build the deposit (when depositSen > 0) and every rent period for a lease.
 * Anchors are counted from the original start date. The last period is cut at
 * endDate and prorated by days used / full anchored period length.
 */
export function generateSchedule(lease: {
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
}): ScheduledInvoice[] {
  const start = parseCivilDate(lease.startDate);
  const end = parseCivilDate(lease.endDate);
  const startIso = formatCivilDate(start);
  const endIso = formatCivilDate(end);

  if (endIso < startIso) {
    throw new Error("endDate must be on or after startDate");
  }
  if (
    !Number.isInteger(lease.monthlyRentSen) ||
    lease.monthlyRentSen <= 0
  ) {
    throw new Error("monthlyRentSen must be a positive integer");
  }
  if (!Number.isInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error("depositSen must be a non-negative integer");
  }

  const schedule: ScheduledInvoice[] = [];

  if (lease.depositSen > 0) {
    schedule.push({
      kind: "deposit",
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: startIso,
      amountSen: lease.depositSen,
    });
  }

  for (let periodIndex = 0; ; periodIndex += 1) {
    const anchor = addCalendarMonths(start, periodIndex);
    const anchorIso = formatCivilDate(anchor);
    if (anchorIso > endIso) break;

    const nextAnchor = addCalendarMonths(start, periodIndex + 1);
    const fullEndIso = addDays(formatCivilDate(nextAnchor), -1);
    const periodEndIso = endIso < fullEndIso ? endIso : fullEndIso;
    const fullDays = inclusiveDayCount(anchorIso, fullEndIso);
    const usedDays = inclusiveDayCount(anchorIso, periodEndIso);

    const amountSen =
      usedDays === fullDays
        ? lease.monthlyRentSen
        : roundHalfUp(
            BigInt(lease.monthlyRentSen) * BigInt(usedDays),
            BigInt(fullDays),
          );

    schedule.push({
      kind: "rent",
      periodIndex,
      periodStart: anchorIso,
      periodEnd: periodEndIso,
      dueDate: anchorIso,
      amountSen,
    });
  }

  return schedule;
}

/**
 * Apply status rules in order: paid, overdue, partially_paid, unpaid.
 * "Today" is the Asia/Kuala_Lumpur civil date of `now`.
 */
export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (
    !Number.isInteger(invoice.amountSen) ||
    invoice.amountSen < 0 ||
    !Number.isInteger(invoice.paidSen) ||
    invoice.paidSen < 0
  ) {
    throw new Error("amountSen and paidSen must be non-negative integers");
  }
  parseCivilDate(invoice.dueDate);

  if (invoice.paidSen >= invoice.amountSen) return "paid";
  if (malaysiaCivilDate(now) > invoice.dueDate) return "overdue";
  if (invoice.paidSen > 0) return "partially_paid";
  return "unpaid";
}

/**
 * Parse a user-typed ringgit amount into sen.
 * Accepts optional comma thousands groups of three and an optional one- or
 * two-digit decimal. Surrounding whitespace is ignored. RM prefixes and
 * other formats throw.
 */
export function parseRinggitToSen(input: string): number {
  if (typeof input !== "string") {
    throw new Error("Invalid ringgit amount");
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid ringgit amount");
  }

  // Whole ringgit, optional groups of exactly three digits, optional 1–2 decimals.
  const match =
    /^(0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Invalid ringgit amount");
  }

  const whole = match[1].replace(/,/g, "");
  const fraction = match[2] ?? "";
  const fractionSen =
    fraction.length === 0
      ? 0
      : fraction.length === 1
        ? Number(fraction) * 10
        : Number(fraction);

  const sen = BigInt(whole) * 100n + BigInt(fractionSen);
  if (sen > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount exceeds safe integer range");
  }
  return Number(sen);
}

function parseCivilDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  if (typeof value !== "string") {
    throw new Error("Invalid date");
  }
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new Error("Invalid date");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) {
    throw new Error("Invalid date");
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error("Invalid date");
  }
  return { year, month, day };
}

function formatCivilDate(date: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarMonths(
  start: { year: number; month: number; day: number },
  months: number,
): { year: number; month: number; day: number } {
  const index = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (year < 1 || year > 9999) {
    throw new Error("Date is out of range");
  }
  return {
    year,
    month,
    day: Math.min(start.day, daysInMonth(year, month)),
  };
}

function addDays(isoDate: string, days: number): string {
  const { year, month, day } = parseCivilDate(isoDate);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatCivilDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function inclusiveDayCount(startIso: string, endIso: string): number {
  const start = parseCivilDate(startIso);
  const end = parseCivilDate(endIso);
  const millis =
    Date.UTC(end.year, end.month - 1, end.day) -
    Date.UTC(start.year, start.month - 1, start.day);
  return Math.round(millis / 86_400_000) + 1;
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new Error("Invalid divisor");
  }
  const value = (numerator + denominator / 2n) / denominator;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount exceeds safe integer range");
  }
  return Number(value);
}

function malaysiaCivilDate(instant: Date): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error("Invalid instant");
  }
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

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
