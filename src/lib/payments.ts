import { Prisma } from "../../generated/prisma/client";
import {
  type Actor,
  requireManager,
  requireStaffOrManager,
} from "@/lib/auth";
import { parseInstant } from "@/lib/dates";
import { AppError, requireUuid } from "@/lib/errors";
import { allocatePaymentAmounts } from "@/lib/allocation";
import { writeAudit } from "@/lib/leases";
import { formatDateOnly } from "@/lib/dates";
import { toSenBigInt, toSenNumber } from "@/lib/money";
import { prisma, type DbTransaction } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RecordPaymentInput {
  amountSen: number;
  method: "cash" | "bank_transfer";
  receivedAt: string;
  slipPath?: string;
}

async function lockLease(tx: DbTransaction, leaseId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM leases
    WHERE id = ${leaseId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "Not found");
  }
}

async function getLeaseBalance(tx: DbTransaction, leaseId: string) {
  const invoices = await tx.invoice.findMany({
    where: { leaseId },
    select: {
      id: true,
      amountSen: true,
      allocations: {
        select: { amountSen: true },
      },
    },
  });

  const invoiceTotal = invoices.reduce(
    (sum, invoice) => sum + invoice.amountSen,
    0n,
  );
  const allocatedTotal = invoices.reduce(
    (sum, invoice) =>
      sum +
      invoice.allocations.reduce(
        (inner, allocation) => inner + allocation.amountSen,
        0n,
      ),
    0n,
  );

  const pending = await tx.payment.aggregate({
    where: { leaseId, status: "pending_verification" },
    _sum: { amountSen: true },
  });

  const pendingTotal = pending._sum.amountSen ?? 0n;
  const remainingBalance = invoiceTotal - allocatedTotal;
  const availableCap = remainingBalance - pendingTotal;

  return {
    invoiceTotal,
    allocatedTotal,
    pendingTotal,
    remainingBalance,
    availableCap,
  };
}

async function allocateApprovedPayment(
  tx: DbTransaction,
  payment: {
    id: string;
    orgId: string;
    leaseId: string;
    amountSen: bigint;
  },
) {
  const existing = await tx.paymentAllocation.count({
    where: { paymentId: payment.id },
  });
  if (existing > 0) {
    return;
  }

  const invoices = await tx.invoice.findMany({
    where: { leaseId: payment.leaseId },
    include: { allocations: true },
  });

  const plan = allocatePaymentAmounts(
    toSenNumber(payment.amountSen),
    invoices.map((invoice) => ({
      id: invoice.id,
      kind: invoice.kind,
      periodIndex: invoice.periodIndex,
      dueDate: formatDateOnly(invoice.dueDate),
      amountSen: toSenNumber(invoice.amountSen),
      paidSen: toSenNumber(
        invoice.allocations.reduce((sum, row) => sum + row.amountSen, 0n),
      ),
    })),
  );

  for (const line of plan.allocations) {
    await tx.paymentAllocation.create({
      data: {
        orgId: payment.orgId,
        paymentId: payment.id,
        invoiceId: line.invoiceId,
        amountSen: toSenBigInt(line.amountSen),
      },
    });
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "approved",
      unappliedSen: toSenBigInt(plan.unappliedSen),
    },
  });
}

function isSafeOrgSlipPath(orgId: string, path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0) return false;
  if (!path.startsWith(`${orgId}/`)) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("//")) {
    return false;
  }
  const rest = path.slice(orgId.length + 1);
  if (rest.length === 0) return false;
  return rest.split("/").every((segment) => segment.length > 0 && segment !== ".");
}

async function removeUploadedSlip(slipPath: string) {
  try {
    const admin = createAdminClient();
    await admin.storage.from("payment-slips").remove([slipPath]);
  } catch {
    // Best-effort cleanup; never mask the original recording error.
  }
}

export async function recordPayment(
  actor: Actor,
  leaseId: string,
  input: RecordPaymentInput,
) {
  requireUuid(leaseId);

  // Visibility before role: other org / other tenant → 404; own lease as tenant → 403.
  const existingLease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!existingLease) {
    throw new AppError(404, "Not found");
  }
  if (actor.kind === "membership") {
    if (actor.orgId !== existingLease.orgId) {
      throw new AppError(404, "Not found");
    }
  } else if (actor.tenantId !== existingLease.tenantId) {
    throw new AppError(404, "Not found");
  } else {
    throw new AppError(403, "Forbidden");
  }
  requireStaffOrManager(actor);

  if (
    !Number.isInteger(input.amountSen) ||
    input.amountSen <= 0 ||
    (input.method !== "cash" && input.method !== "bank_transfer")
  ) {
    throw new AppError(400, "Invalid input");
  }

  let receivedAt: Date;
  try {
    receivedAt = parseInstant(input.receivedAt);
  } catch {
    throw new AppError(400, "Invalid input");
  }

  let uploadedSlip: string | undefined;
  if (input.method === "bank_transfer") {
    if (!isSafeOrgSlipPath(actor.orgId, input.slipPath)) {
      throw new AppError(400, "Invalid input");
    }
    // TASK §6: slip_path must point to an existing object in the org folder.
    const admin = createAdminClient();
    const { error: slipMissing } = await admin.storage
      .from("payment-slips")
      .download(input.slipPath);
    if (slipMissing) {
      throw new AppError(400, "Invalid input");
    }
    uploadedSlip = input.slipPath;
  } else if (input.slipPath) {
    throw new AppError(400, "Invalid input");
  }

  const amountSen = toSenBigInt(input.amountSen);
  const approveImmediately = actor.role === "manager";

  try {
    return await prisma.$transaction(async (tx) => {
      await lockLease(tx, leaseId);

      const lease = await tx.lease.findUnique({ where: { id: leaseId } });
      if (!lease || lease.orgId !== actor.orgId) {
        throw new AppError(404, "Not found");
      }

      const balance = await getLeaseBalance(tx, leaseId);
      if (amountSen > balance.availableCap) {
        throw new AppError(422, "Over the payment cap");
      }

      const payment = await tx.payment.create({
        data: {
          orgId: actor.orgId,
          leaseId,
          amountSen,
          unappliedSen: 0n,
          method: input.method,
          status: approveImmediately ? "approved" : "pending_verification",
          receivedAt,
          slipPath: uploadedSlip ?? null,
        },
      });

      if (approveImmediately) {
        await allocateApprovedPayment(tx, payment);
      }

      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: approveImmediately
          ? "payment.recorded_approved"
          : "payment.recorded_pending",
        entityId: payment.id,
        details: {
          leaseId,
          amountSen: input.amountSen,
          method: input.method,
          receivedAt: input.receivedAt,
        },
      });

      const fresh = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });

      return {
        id: fresh.id,
        status: fresh.status,
      };
    });
  } catch (error) {
    // TASK §4: if recording fails after the upload, do not leave the slip behind.
    if (uploadedSlip) {
      await removeUploadedSlip(uploadedSlip);
    }
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      throw new AppError(409, "Conflict");
    }
    throw error;
  }
}

/** 404 if the payment is invisible; 403 if visible but caller is not a manager. */
async function requireManagerForPayment(actor: Actor, paymentId: string) {
  requireUuid(paymentId);
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { lease: { select: { tenantId: true } } },
  });
  if (!payment) {
    throw new AppError(404, "Not found");
  }
  if (actor.kind === "membership") {
    if (actor.orgId !== payment.orgId) {
      throw new AppError(404, "Not found");
    }
  } else if (actor.tenantId !== payment.lease.tenantId) {
    throw new AppError(404, "Not found");
  } else {
    throw new AppError(403, "Forbidden");
  }
  requireManager(actor);
  return payment;
}

export async function approvePayment(actor: Actor, paymentId: string) {
  await requireManagerForPayment(actor, paymentId);

  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.orgId !== actor.orgId) {
        throw new AppError(404, "Not found");
      }

      await lockLease(tx, payment.leaseId);

      const locked = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!locked || locked.orgId !== actor.orgId) {
        throw new AppError(404, "Not found");
      }
      if (locked.status !== "pending_verification") {
        throw new AppError(409, "Payment is not pending verification");
      }

      const balance = await getLeaseBalance(tx, locked.leaseId);
      // This payment is still pending, so remove it from the pending total when
      // checking the remaining invoice balance.
      const remainingBalance =
        balance.remainingBalance;
      if (locked.amountSen > remainingBalance) {
        throw new AppError(422, "Over the remaining balance");
      }

      await allocateApprovedPayment(tx, locked);

      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "payment.approved",
        entityId: locked.id,
        details: {
          leaseId: locked.leaseId,
          amountSen: toSenNumber(locked.amountSen),
        },
      });

      return { status: "approved" as const };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      throw new AppError(409, "Conflict");
    }
    throw error;
  }
}

export async function rejectPayment(
  actor: Actor,
  paymentId: string,
  reason: string,
) {
  await requireManagerForPayment(actor, paymentId);
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 5) {
    throw new AppError(400, "Missing reason");
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orgId !== actor.orgId) {
      throw new AppError(404, "Not found");
    }

    await lockLease(tx, payment.leaseId);

    const locked = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!locked || locked.orgId !== actor.orgId) {
      throw new AppError(404, "Not found");
    }
    if (locked.status !== "pending_verification") {
      throw new AppError(409, "Payment is not pending verification");
    }

    await tx.payment.update({
      where: { id: locked.id },
      data: { status: "rejected" },
    });

    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "payment.rejected",
      entityId: locked.id,
      details: {
        leaseId: locked.leaseId,
        amountSen: toSenNumber(locked.amountSen),
        reason: trimmed,
      },
    });

    return { status: "rejected" as const };
  });
}

export async function voidPayment(
  actor: Actor,
  paymentId: string,
  reason: string,
) {
  await requireManagerForPayment(actor, paymentId);
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 5) {
    throw new AppError(400, "Missing reason");
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orgId !== actor.orgId) {
      throw new AppError(404, "Not found");
    }

    await lockLease(tx, payment.leaseId);

    const locked = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!locked || locked.orgId !== actor.orgId) {
      throw new AppError(404, "Not found");
    }
    if (locked.status !== "approved") {
      throw new AppError(409, "Payment is not approved");
    }

    await tx.paymentAllocation.deleteMany({
      where: { paymentId: locked.id },
    });

    await tx.payment.update({
      where: { id: locked.id },
      data: {
        status: "voided",
        unappliedSen: 0n,
      },
    });

    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: "payment.voided",
      entityId: locked.id,
      details: {
        leaseId: locked.leaseId,
        amountSen: toSenNumber(locked.amountSen),
        reason: trimmed,
      },
    });

    return { status: "voided" as const };
  });
}

export { lockLease, allocateApprovedPayment, getLeaseBalance };

export async function getCollectionsReport(
  actor: Actor,
  fromMonth: string,
  toMonth: string,
) {
  requireStaffOrManager(actor);

  if (
    !isValidYearMonth(fromMonth) ||
    !isValidYearMonth(toMonth) ||
    fromMonth > toMonth
  ) {
    throw new AppError(400, "Invalid range");
  }

  const rows = await prisma.$queryRaw<{ month: string; total: bigint | null }[]>`
    SELECT to_char(
             (received_at AT TIME ZONE 'Asia/Kuala_Lumpur'),
             'YYYY-MM'
           ) AS month,
           SUM(amount_sen) AS total
    FROM payments
    WHERE org_id = ${actor.orgId}::uuid
      AND status = 'approved'
      AND to_char((received_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM')
          BETWEEN ${fromMonth} AND ${toMonth}
    GROUP BY 1
    ORDER BY 1
  `;

  const byMonth = new Map(
    rows.map((row) => [row.month, toSenNumber(row.total ?? 0n)]),
  );
  const result: { month: string; collectedSen: number }[] = [];
  let cursor = fromMonth;
  while (cursor <= toMonth) {
    result.push({
      month: cursor,
      collectedSen: byMonth.get(cursor) ?? 0,
    });
    cursor = nextYearMonth(cursor);
  }
  return result;
}

function isValidYearMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function nextYearMonth(value: string): string {
  const [yearText, monthText] = value.split("-");
  let year = Number(yearText);
  let month = Number(monthText) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
