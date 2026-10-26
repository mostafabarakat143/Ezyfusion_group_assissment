import { type Actor, requireStaffOrManager } from "@/lib/auth";
import { invoiceStatus } from "@/lib/billing";
import {
  formatDateOnly,
  malaysiaCivilDate,
  shiftYearMonth,
} from "@/lib/dates";
import { getCollectionsReport } from "@/lib/payments";
import { toSenNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export async function getStaffDashboard(actor: Actor) {
  requireStaffOrManager(actor);

  const now = new Date();
  const toMonth = malaysiaCivilDate(now).slice(0, 7);
  const fromMonth = shiftYearMonth(toMonth, -5);
  const collections = await getCollectionsReport(actor, fromMonth, toMonth);

  const invoices = await prisma.invoice.findMany({
    where: { orgId: actor.orgId },
    include: { allocations: true },
  });

  let overdueCount = 0;
  for (const invoice of invoices) {
    const paidSen = toSenNumber(
      invoice.allocations.reduce((sum, row) => sum + row.amountSen, 0n),
    );
    const status = invoiceStatus(
      {
        dueDate: formatDateOnly(invoice.dueDate),
        amountSen: toSenNumber(invoice.amountSen),
        paidSen,
      },
      now,
    );
    if (status === "overdue") overdueCount += 1;
  }

  return { overdueCount, collections, fromMonth, toMonth };
}

export interface ListOrgLeasesOptions {
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listOrgLeases(
  actor: Actor,
  options: ListOrgLeasesOptions = {},
) {
  requireStaffOrManager(actor);

  const pageSize = Math.min(Math.max(options.pageSize ?? 10, 1), 50);
  const page = Math.max(options.page ?? 1, 1);
  const q = options.q?.trim() ?? "";

  const where = {
    orgId: actor.orgId,
    ...(q
      ? {
          OR: [
            { unit: { name: { contains: q, mode: "insensitive" as const } } },
            {
              tenant: {
                fullName: { contains: q, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {}),
  };

  const [total, leases] = await Promise.all([
    prisma.lease.count({ where }),
    prisma.lease.findMany({
      where,
      include: {
        unit: true,
        tenant: true,
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    q,
    page,
    pageSize,
    total,
    totalPages,
    leases: leases.map((lease) => ({
      id: lease.id,
      unitName: lease.unit.name,
      tenantName: lease.tenant.fullName,
      startDate: formatDateOnly(lease.startDate),
      endDate: formatDateOnly(lease.endDate),
      monthlyRentSen: toSenNumber(lease.monthlyRentSen),
      depositSen: toSenNumber(lease.depositSen),
    })),
  };
}

export async function getTenantPortal(actor: Actor) {
  if (actor.kind !== "tenant") {
    throw new Error("Forbidden");
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: actor.tenantId },
  });

  const leases = await prisma.lease.findMany({
    where: { tenantId: actor.tenantId },
    include: { unit: true },
    orderBy: { startDate: "desc" },
  });

  return {
    tenant: {
      id: tenant.id,
      fullName: tenant.fullName,
      email: tenant.email,
      phone: tenant.phone,
    },
    leases: leases.map((lease) => ({
      id: lease.id,
      unitName: lease.unit.name,
      startDate: formatDateOnly(lease.startDate),
      endDate: formatDateOnly(lease.endDate),
    })),
  };
}

export function amountDueNow(
  invoices: {
    dueDate: string;
    amountSen: number;
    paidSen: number;
  }[],
  now = new Date(),
): number {
  const today = malaysiaCivilDate(now);
  return invoices.reduce((sum, invoice) => {
    if (invoice.dueDate > today) return sum;
    const unpaid = invoice.amountSen - invoice.paidSen;
    return unpaid > 0 ? sum + unpaid : sum;
  }, 0);
}
