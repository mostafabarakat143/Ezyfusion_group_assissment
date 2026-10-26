import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { type Actor } from "@/lib/auth";
import { formatDateOnly, malaysiaCivilDate } from "@/lib/dates";
import { getServerEnv } from "@/lib/env";
import { AppError, requireUuid } from "@/lib/errors";
import {
  allocateApprovedPayment,
  lockLease,
} from "@/lib/payments";
import { toSenNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/leases";

export function buildGatewaySignatureSource(
  fields: Record<string, string>,
): string {
  return Object.keys(fields)
    .filter((key) => key !== "x_signature")
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join("|");
}

export function signGatewayFields(
  fields: Record<string, string>,
  secret: string,
): string {
  const source = buildGatewaySignatureSource(fields);
  return createHmac("sha256", secret).update(source).digest("hex");
}

export function verifyGatewaySignature(
  fields: Record<string, string>,
  secret: string,
): boolean {
  const provided = fields.x_signature;
  if (typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  const expected = signGatewayFields(fields, secret);
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/** Parse gateway paid_at values like `2026-04-01 00:30:12 +0800`. */
export function parseGatewayPaidAt(value: string): Date {
  const match =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(
      value.trim(),
    );
  if (!match) {
    throw new AppError(400, "Invalid paid_at");
  }
  const iso = `${match[1]}T${match[2]}${match[3]}:${match[4]}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "Invalid paid_at");
  }
  return date;
}

function newBillId(): string {
  // Cryptographically unpredictable; length well above the DB minimum of 16.
  return `bill_${randomBytes(24).toString("hex")}`;
}

export async function createGatewayBill(actor: Actor, leaseId: string) {
  requireUuid(leaseId);
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      invoices: {
        include: { allocations: true },
      },
    },
  });

  if (!lease) {
    throw new AppError(404, "Not found");
  }

  if (actor.kind === "membership") {
    if (actor.orgId !== lease.orgId) {
      throw new AppError(404, "Not found");
    }
    throw new AppError(403, "Forbidden");
  }

  if (lease.tenantId !== actor.tenantId) {
    throw new AppError(404, "Not found");
  }

  const today = malaysiaCivilDate(new Date());
  let amountSen = 0n;
  for (const invoice of lease.invoices) {
    const dueDate = formatDateOnly(invoice.dueDate);
    if (dueDate > today) continue;
    const paid = invoice.allocations.reduce(
      (sum, row) => sum + row.amountSen,
      0n,
    );
    const unpaid = invoice.amountSen - paid;
    if (unpaid > 0n) amountSen += unpaid;
  }

  if (amountSen <= 0n) {
    throw new AppError(422, "Nothing due");
  }

  const bill = await prisma.gatewayBill.create({
    data: {
      id: newBillId(),
      orgId: lease.orgId,
      leaseId: lease.id,
      amountSen,
      status: "pending",
    },
  });

  return {
    billId: bill.id,
    amountSen: toSenNumber(bill.amountSen),
  };
}

export async function handleGatewayWebhook(
  fields: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { gatewaySignatureKey } = getServerEnv();
  if (!gatewaySignatureKey) {
    throw new AppError(500, "Gateway is not configured");
  }

  if (!verifyGatewaySignature(fields, gatewaySignatureKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  const billId = fields.id;
  if (typeof billId !== "string" || billId.length === 0) {
    return { status: 404, body: { error: "Unknown bill" } };
  }

  // Only the exact strings from the gateway contract; anything else is invalid.
  if (fields.paid !== "true" && fields.paid !== "false") {
    return { status: 400, body: { error: "Invalid paid value" } };
  }
  const paid = fields.paid === "true";

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status
        FROM gateway_bills
        WHERE id = ${billId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        return { status: 404, body: { error: "Unknown bill" } };
      }

      const bill = await tx.gatewayBill.findUniqueOrThrow({
        where: { id: billId },
      });

      if (paid) {
        // Idempotent replay before amount checks so a paid bill never fails a retry.
        if (bill.status === "paid") {
          return { status: 200, body: { ok: true } };
        }

        const paidAmount = Number(fields.paid_amount);
        if (
          !Number.isInteger(paidAmount) ||
          BigInt(paidAmount) !== bill.amountSen
        ) {
          return { status: 422, body: { error: "Incorrect paid amount" } };
        }

        let receivedAt: Date;
        try {
          receivedAt = parseGatewayPaidAt(fields.paid_at ?? "");
        } catch {
          return { status: 400, body: { error: "Invalid paid_at" } };
        }

        await lockLease(tx, bill.leaseId);

        // Re-check after lease lock in case a concurrent callback finished.
        const fresh = await tx.gatewayBill.findUniqueOrThrow({
          where: { id: bill.id },
        });
        if (fresh.status === "paid") {
          return { status: 200, body: { ok: true } };
        }

        await tx.gatewayBill.update({
          where: { id: bill.id },
          data: { status: "paid" },
        });

        const payment = await tx.payment.create({
          data: {
            orgId: bill.orgId,
            leaseId: bill.leaseId,
            amountSen: bill.amountSen,
            unappliedSen: 0n,
            method: "online",
            status: "approved",
            receivedAt,
            gatewayBillId: bill.id,
          },
        });

        await allocateApprovedPayment(tx, payment);

        await writeAudit(tx, {
          orgId: bill.orgId,
          actorId: null,
          action: "payment.online_approved",
          entityId: payment.id,
          details: {
            leaseId: bill.leaseId,
            gatewayBillId: bill.id,
            amountSen: toSenNumber(bill.amountSen),
            transactionId: fields.transaction_id ?? null,
          },
        });

        return { status: 200, body: { ok: true } };
      }

      // paid=false
      if (bill.status === "paid") {
        return { status: 200, body: { ok: true } };
      }
      if (bill.status === "failed") {
        return { status: 200, body: { ok: true } };
      }

      await tx.gatewayBill.update({
        where: { id: bill.id },
        data: { status: "failed" },
      });

      return { status: 200, body: { ok: true } };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { status: 200, body: { ok: true } };
    }
    throw error;
  }
}

export async function getGatewayBillStatus(billId: string) {
  const bill = await prisma.gatewayBill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      amountSen: true,
      status: true,
      leaseId: true,
    },
  });
  if (!bill) {
    throw new AppError(404, "Not found");
  }
  return {
    billId: bill.id,
    leaseId: bill.leaseId,
    amountSen: toSenNumber(bill.amountSen),
    status: bill.status,
  };
}
