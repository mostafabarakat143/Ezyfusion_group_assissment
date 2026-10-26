import { describe, expect, it } from "vitest";
import {
  generateSchedule,
  invoiceStatus,
  parseRinggitToSen,
  type ScheduledInvoice,
} from "./billing";

const AISYAH = {
  startDate: "2026-01-31",
  endDate: "2026-07-15",
  monthlyRentSen: 150_000,
  depositSen: 300_000,
} as const;

describe("generateSchedule", () => {
  it("matches Aisyah's schedule, including the final 77419 sen period", () => {
    const schedule = generateSchedule(AISYAH);

    expect(schedule).toEqual<ScheduledInvoice[]>([
      {
        kind: "deposit",
        periodIndex: null,
        periodStart: null,
        periodEnd: null,
        dueDate: "2026-01-31",
        amountSen: 300_000,
      },
      {
        kind: "rent",
        periodIndex: 0,
        periodStart: "2026-01-31",
        periodEnd: "2026-02-27",
        dueDate: "2026-01-31",
        amountSen: 150_000,
      },
      {
        kind: "rent",
        periodIndex: 1,
        periodStart: "2026-02-28",
        periodEnd: "2026-03-30",
        dueDate: "2026-02-28",
        amountSen: 150_000,
      },
      {
        kind: "rent",
        periodIndex: 2,
        periodStart: "2026-03-31",
        periodEnd: "2026-04-29",
        dueDate: "2026-03-31",
        amountSen: 150_000,
      },
      {
        kind: "rent",
        periodIndex: 3,
        periodStart: "2026-04-30",
        periodEnd: "2026-05-30",
        dueDate: "2026-04-30",
        amountSen: 150_000,
      },
      {
        kind: "rent",
        periodIndex: 4,
        periodStart: "2026-05-31",
        periodEnd: "2026-06-29",
        dueDate: "2026-05-31",
        amountSen: 150_000,
      },
      {
        kind: "rent",
        periodIndex: 5,
        periodStart: "2026-06-30",
        periodEnd: "2026-07-15",
        dueDate: "2026-06-30",
        amountSen: 77_419,
      },
    ]);

    expect(schedule.at(-1)?.amountSen).toBe(77_419);
  });

  it("omits the deposit when depositSen is 0 and anchors from the start day", () => {
    const schedule = generateSchedule({
      startDate: "2024-01-31",
      endDate: "2024-03-15",
      monthlyRentSen: 100_000,
      depositSen: 0,
    });

    expect(schedule.map((row) => row.kind)).toEqual(["rent", "rent"]);
    expect(schedule[0]).toMatchObject({
      periodStart: "2024-01-31",
      periodEnd: "2024-02-28",
      dueDate: "2024-01-31",
      amountSen: 100_000,
    });
    // Cut at endDate: 2024-02-29 to 2024-03-15 uses 16 of 31 full days.
    expect(schedule[1]).toMatchObject({
      periodStart: "2024-02-29",
      periodEnd: "2024-03-15",
      dueDate: "2024-02-29",
      amountSen: 51_613,
    });
  });

  it("rejects invalid dates, ranges, and money values", () => {
    expect(() =>
      generateSchedule({ ...AISYAH, startDate: "2026-02-29" }),
    ).toThrow(Error);
    expect(() =>
      generateSchedule({ ...AISYAH, endDate: "2026-01-30" }),
    ).toThrow(Error);
    expect(() =>
      generateSchedule({ ...AISYAH, monthlyRentSen: 0 }),
    ).toThrow(Error);
    expect(() =>
      generateSchedule({ ...AISYAH, monthlyRentSen: 1.5 }),
    ).toThrow(Error);
    expect(() =>
      generateSchedule({ ...AISYAH, depositSen: -1 }),
    ).toThrow(Error);
    expect(() =>
      generateSchedule({ ...AISYAH, startDate: "2026-1-31" }),
    ).toThrow(Error);
  });

  it("handles month-end anchors across leap and common Februaries", () => {
    const leap = generateSchedule({
      startDate: "2024-01-31",
      endDate: "2024-02-29",
      monthlyRentSen: 31_000,
      depositSen: 0,
    });
    expect(leap[0].periodEnd).toBe("2024-02-28");
    expect(leap[1]).toMatchObject({
      periodStart: "2024-02-29",
      periodEnd: "2024-02-29",
      dueDate: "2024-02-29",
    });
    // Full period is 2024-02-29 to 2024-03-30 (31 days); one day costs 1000.
    expect(leap[1].amountSen).toBe(1_000);

    const common = generateSchedule({
      startDate: "2023-01-31",
      endDate: "2023-02-28",
      monthlyRentSen: 31_000,
      depositSen: 0,
    });
    expect(common[1]).toMatchObject({
      periodStart: "2023-02-28",
      periodEnd: "2023-02-28",
      amountSen: 1_000,
    });
  });

  it("rounds half up for the final partial period", () => {
    // 15 of 30 days of 100 sen → 50 exactly.
    expect(
      generateSchedule({
        startDate: "2026-04-01",
        endDate: "2026-04-15",
        monthlyRentSen: 100,
        depositSen: 0,
      })[0].amountSen,
    ).toBe(50);

    // 1 of 30 days of 15 sen → 0.5 → 1.
    expect(
      generateSchedule({
        startDate: "2026-04-01",
        endDate: "2026-04-01",
        monthlyRentSen: 15,
        depositSen: 0,
      })[0].amountSen,
    ).toBe(1);

    // 1 of 30 days of 14 sen → 0.466... → 0.
    expect(
      generateSchedule({
        startDate: "2026-04-01",
        endDate: "2026-04-01",
        monthlyRentSen: 14,
        depositSen: 0,
      })[0].amountSen,
    ).toBe(0);
  });
});

describe("invoiceStatus", () => {
  const base = {
    dueDate: "2026-03-01",
    amountSen: 10_000,
    paidSen: 0,
  };

  it("applies paid, overdue, partially_paid, then unpaid in that order", () => {
    expect(
      invoiceStatus(
        { ...base, paidSen: 10_000 },
        new Date("2026-03-10T00:00:00.000Z"),
      ),
    ).toBe("paid");
    expect(
      invoiceStatus(
        { ...base, paidSen: 10_001 },
        new Date("2026-03-10T00:00:00.000Z"),
      ),
    ).toBe("paid");
    expect(
      invoiceStatus(base, new Date("2026-03-01T15:59:59.999Z")),
    ).toBe("unpaid");
    expect(
      invoiceStatus(base, new Date("2026-03-01T16:00:00.000Z")),
    ).toBe("overdue");
    expect(
      invoiceStatus(
        { ...base, paidSen: 1 },
        new Date("2026-03-01T16:00:00.000Z"),
      ),
    ).toBe("overdue");
    expect(
      invoiceStatus(
        { ...base, paidSen: 1 },
        new Date("2026-03-01T15:59:59.999Z"),
      ),
    ).toBe("partially_paid");
  });

  it("uses Malaysia civil dates across host timezones", () => {
    // 2026-06-15T04:00:00Z is 14 June in New York and 15 June in Malaysia.
    expect(
      invoiceStatus(
        { dueDate: "2026-06-14", amountSen: 100, paidSen: 0 },
        new Date("2026-06-15T04:00:00.000Z"),
      ),
    ).toBe("overdue");
    expect(
      invoiceStatus(
        { dueDate: "2026-06-15", amountSen: 100, paidSen: 0 },
        new Date("2026-06-14T16:00:00.000Z"),
      ),
    ).toBe("unpaid");
  });
});

describe("parseRinggitToSen", () => {
  it("accepts whole ringgit, one or two decimals, and comma groups", () => {
    expect(parseRinggitToSen("7")).toBe(700);
    expect(parseRinggitToSen("1.15")).toBe(115);
    expect(parseRinggitToSen("1.1")).toBe(110);
    expect(parseRinggitToSen("1,500.50")).toBe(150_050);
    expect(parseRinggitToSen("1,500")).toBe(150_000);
    expect(parseRinggitToSen(" 1,500.50 ")).toBe(150_050);
    expect(parseRinggitToSen("0")).toBe(0);
    expect(parseRinggitToSen("0.01")).toBe(1);
  });

  it("rejects RM prefixes and invalid formatting", () => {
    for (const value of [
      "",
      " ",
      "-5",
      "1.234",
      "1e3",
      "RM 10",
      "RM10",
      "1,23",
      "1,2345.00",
      "+1",
      "01,500.50",
      "1 500.50",
    ]) {
      expect(() => parseRinggitToSen(value)).toThrow(Error);
    }
  });
});
