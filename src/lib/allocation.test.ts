import { describe, expect, it } from "vitest";
import { allocatePaymentAmounts } from "@/lib/allocation";

describe("allocatePaymentAmounts", () => {
  const invoices = [
    {
      id: "rent-0",
      kind: "rent" as const,
      periodIndex: 0,
      dueDate: "2026-01-31",
      amountSen: 150_000,
      paidSen: 0,
    },
    {
      id: "deposit",
      kind: "deposit" as const,
      periodIndex: null,
      dueDate: "2026-01-31",
      amountSen: 300_000,
      paidSen: 0,
    },
    {
      id: "rent-1",
      kind: "rent" as const,
      periodIndex: 1,
      dueDate: "2026-02-28",
      amountSen: 150_000,
      paidSen: 0,
    },
  ];

  it("orders by due date, then deposit before rent, then period index", () => {
    const result = allocatePaymentAmounts(500_000, invoices);
    expect(result.allocations.map((row) => row.invoiceId)).toEqual([
      "deposit",
      "rent-0",
      "rent-1",
    ]);
    expect(result.allocations.map((row) => row.amountSen)).toEqual([
      300_000, 150_000, 50_000,
    ]);
    expect(result.unappliedSen).toBe(0);
  });

  it("fills only unpaid amounts and skips fully paid invoices", () => {
    const result = allocatePaymentAmounts(200_000, [
      { ...invoices[1], paidSen: 300_000 },
      { ...invoices[0], paidSen: 100_000 },
      invoices[2],
    ]);
    expect(result.allocations).toEqual([
      { invoiceId: "rent-0", amountSen: 50_000 },
      { invoiceId: "rent-1", amountSen: 150_000 },
    ]);
    expect(result.unappliedSen).toBe(0);
  });

  it("stores leftover as unappliedSen for overpayment (online)", () => {
    const result = allocatePaymentAmounts(100_000, [
      {
        id: "only",
        kind: "rent",
        periodIndex: 0,
        dueDate: "2026-03-01",
        amountSen: 40_000,
        paidSen: 0,
      },
    ]);
    expect(result.allocations).toEqual([
      { invoiceId: "only", amountSen: 40_000 },
    ]);
    expect(result.unappliedSen).toBe(60_000);
  });

  it("allocates nothing when all invoices are already paid", () => {
    const result = allocatePaymentAmounts(10_000, [
      { ...invoices[0], paidSen: 150_000 },
      { ...invoices[1], paidSen: 300_000 },
    ]);
    expect(result.allocations).toEqual([]);
    expect(result.unappliedSen).toBe(10_000);
  });
});
