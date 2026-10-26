/** Allocation order: due date, deposit before rent, then period index. */
export function compareInvoicesForAllocation(
  a: {
    dueDate: Date | string;
    kind: "deposit" | "rent";
    periodIndex: number | null;
  },
  b: {
    dueDate: Date | string;
    kind: "deposit" | "rent";
    periodIndex: number | null;
  },
): number {
  const aDue =
    typeof a.dueDate === "string"
      ? a.dueDate
      : formatUtcDateOnly(a.dueDate);
  const bDue =
    typeof b.dueDate === "string"
      ? b.dueDate
      : formatUtcDateOnly(b.dueDate);
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "deposit" ? -1 : 1;
  const aIndex = a.periodIndex ?? -1;
  const bIndex = b.periodIndex ?? -1;
  return aIndex - bIndex;
}

function formatUtcDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface AllocationInvoiceInput {
  id: string;
  kind: "deposit" | "rent";
  periodIndex: number | null;
  dueDate: string;
  amountSen: number;
  paidSen: number;
}

export interface AllocationLine {
  invoiceId: string;
  amountSen: number;
}

export interface AllocationResult {
  allocations: AllocationLine[];
  unappliedSen: number;
}

/**
 * Pure allocation: due date, then deposit before rent, then period index.
 * Fills unpaid amounts in order; leftover becomes unappliedSen (online only
 * in practice, because manual payments are capped).
 */
export function allocatePaymentAmounts(
  amountSen: number,
  invoices: AllocationInvoiceInput[],
): AllocationResult {
  if (!Number.isInteger(amountSen) || amountSen < 0) {
    throw new Error("amountSen must be a non-negative integer");
  }

  const sorted = [...invoices].sort(compareInvoicesForAllocation);
  let remaining = amountSen;
  const allocations: AllocationLine[] = [];

  for (const invoice of sorted) {
    if (remaining <= 0) break;
    if (
      !Number.isInteger(invoice.amountSen) ||
      !Number.isInteger(invoice.paidSen) ||
      invoice.paidSen < 0 ||
      invoice.amountSen < 0
    ) {
      throw new Error("invoice amounts must be non-negative integers");
    }
    const unpaid = invoice.amountSen - invoice.paidSen;
    if (unpaid <= 0) continue;
    const apply = remaining < unpaid ? remaining : unpaid;
    allocations.push({ invoiceId: invoice.id, amountSen: apply });
    remaining -= apply;
  }

  return { allocations, unappliedSen: remaining };
}
