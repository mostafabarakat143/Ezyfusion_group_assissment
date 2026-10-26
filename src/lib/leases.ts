import { Prisma } from "../../generated/prisma/client";
import {
  type Actor,
  isLeaseReadableBy,
  requireManager,
} from "@/lib/auth";
import { compareInvoicesForAllocation } from "@/lib/allocation";
import { invoiceStatus, generateSchedule } from "@/lib/billing";
import {
  formatDateOnly,
  formatInstant,
  parseDateOnly,
} from "@/lib/dates";
import { AppError, requireUuid } from "@/lib/errors";
import { toSenBigInt, toSenNumber } from "@/lib/money";
import { prisma, type DbTransaction } from "@/lib/prisma";

export { compareInvoicesForAllocation };

export interface CreateLeaseInput {
  unitId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
}

export async function createLease(actor: Actor, input: CreateLeaseInput) {
  requireManager(actor);

  let schedule;
  try {
    schedule = generateSchedule({
      startDate: input.startDate,
      endDate: input.endDate,
      monthlyRentSen: input.monthlyRentSen,
      depositSen: input.depositSen,
    });
  } catch {
    throw new AppError(400, "Invalid input");
  }

  if (typeof input.unitId !== "string" || typeof input.tenantId !== "string") {
    throw new AppError(400, "Invalid input");
  }
  requireUuid(input.unitId);
  requireUuid(input.tenantId);

  const unit = await prisma.unit.findFirst({
    where: { id: input.unitId, orgId: actor.orgId },
  });
  const tenant = await prisma.tenant.findFirst({
    where: { id: input.tenantId, orgId: actor.orgId },
  });
  if (!unit || !tenant) {
    throw new AppError(404, "Not found");
  }

  try {
    const lease = await prisma.$transaction(async (tx) => {
      const created = await tx.lease.create({
        data: {
          orgId: actor.orgId,
          unitId: unit.id,
          tenantId: tenant.id,
          startDate: parseDateOnly(input.startDate),
          endDate: parseDateOnly(input.endDate),
          monthlyRentSen: toSenBigInt(input.monthlyRentSen),
          depositSen: toSenBigInt(input.depositSen),
        },
      });

      await tx.invoice.createMany({
        data: schedule.map((row) => ({
          orgId: actor.orgId,
          leaseId: created.id,
          kind: row.kind,
          periodIndex: row.periodIndex,
          periodStart: row.periodStart
            ? parseDateOnly(row.periodStart)
            : null,
          periodEnd: row.periodEnd ? parseDateOnly(row.periodEnd) : null,
          dueDate: parseDateOnly(row.dueDate),
          amountSen: toSenBigInt(row.amountSen),
        })),
      });

      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "lease.created",
        entityId: created.id,
        details: {
          unitId: unit.id,
          tenantId: tenant.id,
          startDate: input.startDate,
          endDate: input.endDate,
          monthlyRentSen: input.monthlyRentSen,
          depositSen: input.depositSen,
          invoiceCount: schedule.length,
        },
      });

      return created;
    });

    return { id: lease.id };
  } catch (error) {
    if (isOverlapError(error)) {
      throw new AppError(409, "Overlaps another lease on the unit");
    }
    throw error;
  }
}

export async function getLeaseDetail(actor: Actor, leaseId: string) {
  requireUuid(leaseId);
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      invoices: {
        include: {
          allocations: true,
        },
      },
      payments: {
        include: {
          allocations: {
            select: {
              id: true,
              invoiceId: true,
              amountSen: true,
            },
          },
        },
        orderBy: { receivedAt: "asc" },
      },
    },
  });

  if (!lease || !isLeaseReadableBy(actor, lease)) {
    throw new AppError(404, "Not found");
  }

  if (actor.kind === "membership" && actor.orgId !== lease.orgId) {
    throw new AppError(404, "Not found");
  }

  const now = new Date();
  const invoices = [...lease.invoices]
    .sort(compareInvoicesForAllocation)
    .map((invoice) => {
      const paidSen = invoice.allocations.reduce(
        (sum, row) => sum + row.amountSen,
        0n,
      );
      const amountSen = toSenNumber(invoice.amountSen);
      const paid = toSenNumber(paidSen);
      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.periodIndex,
        periodStart: invoice.periodStart
          ? formatDateOnly(invoice.periodStart)
          : null,
        periodEnd: invoice.periodEnd
          ? formatDateOnly(invoice.periodEnd)
          : null,
        dueDate: formatDateOnly(invoice.dueDate),
        amountSen,
        paidSen: paid,
        status: invoiceStatus(
          {
            dueDate: formatDateOnly(invoice.dueDate),
            amountSen,
            paidSen: paid,
          },
          now,
        ),
      };
    });

  const invoiceLabels = new Map(
    invoices.map((invoice) => [
      invoice.id,
      invoice.kind === "deposit"
        ? "Deposit"
        : `Rent #${invoice.periodIndex ?? "?"}`,
    ]),
  );

  return {
    lease: {
      id: lease.id,
      unitId: lease.unitId,
      tenantId: lease.tenantId,
      startDate: formatDateOnly(lease.startDate),
      endDate: formatDateOnly(lease.endDate),
      monthlyRentSen: toSenNumber(lease.monthlyRentSen),
      depositSen: toSenNumber(lease.depositSen),
    },
    invoices,
    payments: lease.payments.map((payment) => ({
      id: payment.id,
      amountSen: toSenNumber(payment.amountSen),
      unappliedSen: toSenNumber(payment.unappliedSen),
      method: payment.method,
      status: payment.status,
      receivedAt: formatInstant(payment.receivedAt),
      allocations: payment.allocations.map((allocation) => ({
        id: allocation.id,
        invoiceId: allocation.invoiceId,
        invoiceLabel: invoiceLabels.get(allocation.invoiceId) ?? "Invoice",
        amountSen: toSenNumber(allocation.amountSen),
      })),
    })),
  };
}

export async function writeAudit(
  tx: DbTransaction,
  input: {
    orgId: string;
    actorId: string | null;
    action: string;
    entityId: string;
    details: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      orgId: input.orgId,
      actorId: input.actorId,
      action: input.action,
      entityId: input.entityId,
      details: input.details,
    },
  });
}

function isOverlapError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002" || error.code === "P2034";
  }
  const text = error instanceof Error ? error.message : String(error);
  return (
    text.includes("leases_unit_no_overlap") ||
    text.includes("23P01") ||
    text.includes("exclusion constraint")
  );
}
