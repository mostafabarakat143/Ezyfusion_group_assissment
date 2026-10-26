import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { POST as createBillRoute } from "@/app/api/leases/[leaseId]/gateway-bills/route";
import { POST as webhookRoute } from "@/app/api/webhooks/gateway/route";
import { POST as rejectRoute } from "@/app/api/payments/[paymentId]/reject/route";
import { POST as voidRoute } from "@/app/api/payments/[paymentId]/void/route";
import { POST as recordPaymentRoute } from "@/app/api/leases/[leaseId]/payments/route";
import { GET as getLeaseRoute } from "@/app/api/leases/[leaseId]/route";
import {
  buildGatewaySignatureSource,
  handleGatewayWebhook,
  signGatewayFields,
  verifyGatewaySignature,
} from "@/lib/gateway";
import { prisma } from "@/lib/prisma";
import { SEED_PASSWORD } from "@/lib/seed-constants";
import { recordPayment } from "@/lib/payments";
import type { Actor } from "@/lib/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const signatureKey = process.env.GATEWAY_X_SIGNATURE_KEY!;

async function signIn(email: string) {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) {
    throw error ?? new Error(`No session for ${email}`);
  }
  return data.session.access_token;
}

function authRequest(url: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(url, { ...init, headers });
}

function signedFields(
  fields: Record<string, string>,
  key = signatureKey,
): Record<string, string> {
  return {
    ...fields,
    x_signature: signGatewayFields(fields, key),
  };
}

function webhookRequest(fields: Record<string, string>) {
  return new Request("http://localhost/api/webhooks/gateway", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

function uniqueBillId(tag: string) {
  return `bill_${tag}_${randomBytes(12).toString("hex")}`;
}

async function deleteGatewayBillCascade(billId: string) {
  const payments = await prisma.payment.findMany({
    where: { gatewayBillId: billId },
    select: { id: true },
  });
  for (const payment of payments) {
    await prisma.paymentAllocation.deleteMany({
      where: { paymentId: payment.id },
    });
  }
  await prisma.payment.deleteMany({ where: { gatewayBillId: billId } });
  await prisma.gatewayBill.deleteMany({ where: { id: billId } });
}

describe("gateway signature", () => {
  it("matches the TASK.md test vector", () => {
    const fields = {
      id: "bill_8f3a2c",
      paid: "true",
      paid_amount: "210050",
      paid_at: "2026-04-01 00:30:12 +0800",
      transaction_id: "TX-000123",
      transaction_status: "completed",
    };
    const source = buildGatewaySignatureSource(fields);
    expect(source).toBe(
      "idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted",
    );
    const signature = createHmac("sha256", "test_x_signature_key")
      .update(source)
      .digest("hex");
    expect(signature).toBe(
      "06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641",
    );
    expect(
      verifyGatewaySignature(
        { ...fields, x_signature: signature },
        "test_x_signature_key",
      ),
    ).toBe(true);
  });

  it("includes extra fields in the signature source", () => {
    const fields = {
      id: "bill_extra",
      paid: "true",
      paid_amount: "1",
      paid_at: "2026-04-01 00:30:12 +0800",
      transaction_id: "TX-1",
      transaction_status: "completed",
      custom: "yes",
    };
    const source = buildGatewaySignatureSource(fields);
    expect(source.startsWith("customyes|")).toBe(true);
  });
});

describe("reject, void, and gateway webhook", () => {
  let managerToken: string;
  let staffToken: string;
  let aisyahToken: string;
  let benToken: string;
  let betaManagerToken: string;
  let aisyahLeaseId: string;
  let benLeaseId: string;
  let northwindOrgId: string;
  let managerActor: Actor;

  beforeAll(async () => {
    managerToken = await signIn("manager@northwind.test");
    staffToken = await signIn("staff@northwind.test");
    aisyahToken = await signIn("aisyah@northwind.test");
    benToken = await signIn("ben@northwind.test");
    betaManagerToken = await signIn("manager@beta.test");

    const northwind = await prisma.organization.findFirstOrThrow({
      where: { name: "Northwind Properties" },
    });
    northwindOrgId = northwind.id;
    const membership = await prisma.membership.findFirstOrThrow({
      where: { orgId: northwind.id, role: "manager" },
    });
    managerActor = {
      kind: "membership",
      userId: membership.userId,
      orgId: northwind.id,
      role: "manager",
    };

    const aisyah = await prisma.tenant.findFirstOrThrow({
      where: { email: "aisyah@northwind.test" },
    });
    const ben = await prisma.tenant.findFirstOrThrow({
      where: { email: "ben@northwind.test" },
    });
    aisyahLeaseId = (
      await prisma.lease.findFirstOrThrow({ where: { tenantId: aisyah.id } })
    ).id;
    benLeaseId = (
      await prisma.lease.findFirstOrThrow({ where: { tenantId: ben.id } })
    ).id;
  }, 60_000);

  it("rejects only pending payments with a valid reason", async () => {
    const pending = await recordPaymentRoute(
      authRequest(
        `http://localhost/api/leases/${benLeaseId}/payments`,
        staffToken,
        {
          method: "POST",
          body: JSON.stringify({
            amountSen: 5_000,
            method: "cash",
            receivedAt: "2027-02-01T10:00:00+08:00",
          }),
        },
      ),
      { params: Promise.resolve({ leaseId: benLeaseId }) },
    );
    expect(pending.status).toBe(201);
    const { id } = await pending.json();

    const shortReason = await rejectRoute(
      authRequest(`http://localhost/api/payments/${id}/reject`, managerToken, {
        method: "POST",
        body: JSON.stringify({ reason: "no" }),
      }),
      { params: Promise.resolve({ paymentId: id }) },
    );
    expect(shortReason.status).toBe(400);

    const staffReject = await rejectRoute(
      authRequest(`http://localhost/api/payments/${id}/reject`, staffToken, {
        method: "POST",
        body: JSON.stringify({ reason: "not enough" }),
      }),
      { params: Promise.resolve({ paymentId: id }) },
    );
    expect(staffReject.status).toBe(403);

    const rejected = await rejectRoute(
      authRequest(`http://localhost/api/payments/${id}/reject`, managerToken, {
        method: "POST",
        body: JSON.stringify({ reason: "slip unclear" }),
      }),
      { params: Promise.resolve({ paymentId: id }) },
    );
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual({ status: "rejected" });

    const again = await rejectRoute(
      authRequest(`http://localhost/api/payments/${id}/reject`, managerToken, {
        method: "POST",
        body: JSON.stringify({ reason: "slip unclear" }),
      }),
      { params: Promise.resolve({ paymentId: id }) },
    );
    expect(again.status).toBe(409);
  });

  it("voids only approved payments and removes only that payment's allocations", async () => {
    const created = await recordPayment(managerActor, benLeaseId, {
      amountSen: 8_000,
      method: "cash",
      receivedAt: "2027-02-02T10:00:00+08:00",
    });

    const before = await getLeaseRoute(
      authRequest(`http://localhost/api/leases/${benLeaseId}`, managerToken),
      { params: Promise.resolve({ leaseId: benLeaseId }) },
    );
    const beforeBody = await before.json();
    const paidBefore = beforeBody.invoices.reduce(
      (sum: number, row: { paidSen: number }) => sum + row.paidSen,
      0,
    );

    const voided = await voidRoute(
      authRequest(
        `http://localhost/api/payments/${created.id}/void`,
        managerToken,
        {
          method: "POST",
          body: JSON.stringify({ reason: "entered twice" }),
        },
      ),
      { params: Promise.resolve({ paymentId: created.id }) },
    );
    expect(voided.status).toBe(200);
    expect(await voided.json()).toEqual({ status: "voided" });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: created.id },
      include: { allocations: true },
    });
    expect(payment.status).toBe("voided");
    expect(payment.allocations).toHaveLength(0);

    const after = await getLeaseRoute(
      authRequest(`http://localhost/api/leases/${benLeaseId}`, managerToken),
      { params: Promise.resolve({ leaseId: benLeaseId }) },
    );
    const afterBody = await after.json();
    const paidAfter = afterBody.invoices.reduce(
      (sum: number, row: { paidSen: number }) => sum + row.paidSen,
      0,
    );
    expect(paidAfter).toBe(paidBefore - 8_000);

    const notApproved = await voidRoute(
      authRequest(
        `http://localhost/api/payments/${created.id}/void`,
        managerToken,
        {
          method: "POST",
          body: JSON.stringify({ reason: "entered twice" }),
        },
      ),
      { params: Promise.resolve({ paymentId: created.id }) },
    );
    expect(notApproved.status).toBe(409);
  });

  it("creates gateway bills only for the lease tenant and due unpaid amount", async () => {
    const forbidden = await createBillRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}/gateway-bills`,
        managerToken,
        { method: "POST" },
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(forbidden.status).toBe(403);

    const crossTenant = await createBillRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}/gateway-bills`,
        benToken,
        { method: "POST" },
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(crossTenant.status).toBe(404);

    const crossOrg = await createBillRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}/gateway-bills`,
        betaManagerToken,
        { method: "POST" },
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(crossOrg.status).toBe(404);

    const created = await createBillRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}/gateway-bills`,
        aisyahToken,
        { method: "POST" },
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.billId.length).toBeGreaterThanOrEqual(16);
    expect(body.amountSen).toBeGreaterThan(0);
    expect(typeof body.amountSen).toBe("number");
  });

  it("rejects forged signatures and incorrect paid amounts", async () => {
    const bill = await prisma.gatewayBill.create({
      data: {
        id: uniqueBillId("a"),
        orgId: northwindOrgId,
        leaseId: benLeaseId,
        amountSen: 12_345n,
        status: "pending",
      },
    });

    try {
      const forged = await webhookRoute(
        webhookRequest(
          signedFields(
            {
              id: bill.id,
              paid: "true",
              paid_amount: "12345",
              paid_at: "2026-04-01 00:30:12 +0800",
              transaction_id: "TX-FORGED",
              transaction_status: "completed",
            },
            "wrong_key",
          ),
        ),
      );
      expect(forged.status).toBe(401);

      const wrongAmount = await webhookRoute(
        webhookRequest(
          signedFields({
            id: bill.id,
            paid: "true",
            paid_amount: "1",
            paid_at: "2026-04-01 00:30:12 +0800",
            transaction_id: "TX-WRONG",
            transaction_status: "completed",
          }),
        ),
      );
      expect(wrongAmount.status).toBe(422);

      const unknown = await webhookRoute(
        webhookRequest(
          signedFields({
            id: uniqueBillId("b"),
            paid: "true",
            paid_amount: "1",
            paid_at: "2026-04-01 00:30:12 +0800",
            transaction_id: "TX-UNKNOWN",
            transaction_status: "completed",
          }),
        ),
      );
      expect(unknown.status).toBe(404);
    } finally {
      await deleteGatewayBillCascade(bill.id);
    }
  });

  it("settles paid callbacks once, including duplicates and concurrent deliveries", async () => {
    const bill = await prisma.gatewayBill.create({
      data: {
        id: uniqueBillId("c"),
        orgId: northwindOrgId,
        leaseId: benLeaseId,
        amountSen: 25_000n,
        status: "pending",
      },
    });
    let concurrentBillId: string | null = null;

    try {
      const fields = signedFields({
        id: bill.id,
        paid: "true",
        paid_amount: "25000",
        paid_at: "2026-04-01 00:30:12 +0800",
        transaction_id: "TX-PAY",
        transaction_status: "completed",
        extra: "1",
      });

      const first = await handleGatewayWebhook(fields);
      expect(first.status).toBe(200);

      const duplicate = await handleGatewayWebhook(fields);
      expect(duplicate.status).toBe(200);

      const payments = await prisma.payment.findMany({
        where: { gatewayBillId: bill.id },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0].method).toBe("online");
      expect(payments[0].status).toBe("approved");
      expect(payments[0].receivedAt.toISOString()).toBe(
        new Date("2026-04-01T00:30:12+08:00").toISOString(),
      );

      const concurrentBill = await prisma.gatewayBill.create({
        data: {
          id: uniqueBillId("d"),
          orgId: northwindOrgId,
          leaseId: benLeaseId,
          amountSen: 15_000n,
          status: "pending",
        },
      });
      concurrentBillId = concurrentBill.id;
      const concurrentFields = signedFields({
        id: concurrentBill.id,
        paid: "true",
        paid_amount: "15000",
        paid_at: "2026-04-02 00:30:12 +0800",
        transaction_id: "TX-CONCURRENT",
        transaction_status: "completed",
      });
      const concurrent = await Promise.all([
        handleGatewayWebhook(concurrentFields),
        handleGatewayWebhook(concurrentFields),
      ]);
      expect(concurrent.every((row) => row.status === 200)).toBe(true);
      expect(
        await prisma.payment.count({
          where: { gatewayBillId: concurrentBill.id },
        }),
      ).toBe(1);
    } finally {
      await deleteGatewayBillCascade(bill.id);
      if (concurrentBillId) {
        await deleteGatewayBillCascade(concurrentBillId);
      }
    }
  });

  it("rejects paid values that are not exactly true or false", async () => {
    const bill = await prisma.gatewayBill.create({
      data: {
        id: uniqueBillId("paid-val"),
        orgId: northwindOrgId,
        leaseId: benLeaseId,
        amountSen: 9_000n,
        status: "pending",
      },
    });

    try {
      const result = await handleGatewayWebhook(
        signedFields({
          id: bill.id,
          paid: "TRUE",
          paid_amount: "9000",
          paid_at: "2026-04-04 00:30:12 +0800",
          transaction_id: "TX-BAD-PAID",
          transaction_status: "completed",
        }),
      );
      expect(result.status).toBe(400);
      expect(
        (await prisma.gatewayBill.findUniqueOrThrow({ where: { id: bill.id } }))
          .status,
      ).toBe("pending");
    } finally {
      await deleteGatewayBillCascade(bill.id);
    }
  });

  it("allows failed-to-paid and never demotes paid-to-failed", async () => {
    const bill = await prisma.gatewayBill.create({
      data: {
        id: uniqueBillId("e"),
        orgId: northwindOrgId,
        leaseId: benLeaseId,
        amountSen: 11_000n,
        status: "pending",
      },
    });

    try {
      const failed = await handleGatewayWebhook(
        signedFields({
          id: bill.id,
          paid: "false",
          paid_amount: "0",
          paid_at: "2026-04-03 00:30:12 +0800",
          transaction_id: "TX-FAIL",
          transaction_status: "failed",
        }),
      );
      expect(failed.status).toBe(200);
      expect(
        (await prisma.gatewayBill.findUniqueOrThrow({ where: { id: bill.id } }))
          .status,
      ).toBe("failed");

      const paid = await handleGatewayWebhook(
        signedFields({
          id: bill.id,
          paid: "true",
          paid_amount: "11000",
          paid_at: "2026-04-03 01:30:12 +0800",
          transaction_id: "TX-RECOVER",
          transaction_status: "completed",
        }),
      );
      expect(paid.status).toBe(200);
      expect(
        (await prisma.gatewayBill.findUniqueOrThrow({ where: { id: bill.id } }))
          .status,
      ).toBe("paid");

      const lateFailed = await handleGatewayWebhook(
        signedFields({
          id: bill.id,
          paid: "false",
          paid_amount: "0",
          paid_at: "2026-04-03 02:30:12 +0800",
          transaction_id: "TX-LATE",
          transaction_status: "failed",
        }),
      );
      expect(lateFailed.status).toBe(200);
      expect(
        (await prisma.gatewayBill.findUniqueOrThrow({ where: { id: bill.id } }))
          .status,
      ).toBe("paid");
      expect(
        await prisma.payment.count({ where: { gatewayBillId: bill.id } }),
      ).toBe(1);
    } finally {
      await deleteGatewayBillCascade(bill.id);
    }
  });

  it("keeps payment caps correct after voiding restores balance", async () => {
    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: benLeaseId },
      include: {
        invoices: { include: { allocations: true } },
        payments: true,
      },
    });
    const invoiceTotal = lease.invoices.reduce(
      (sum, invoice) => sum + invoice.amountSen,
      0n,
    );
    const allocated = lease.invoices.reduce(
      (sum, invoice) =>
        sum +
        invoice.allocations.reduce(
          (inner, allocation) => inner + allocation.amountSen,
          0n,
        ),
      0n,
    );
    const remaining = Number(invoiceTotal - allocated);
    expect(remaining).toBeGreaterThan(0);

    const payment = await recordPayment(managerActor, benLeaseId, {
      amountSen: remaining,
      method: "cash",
      receivedAt: "2027-03-01T10:00:00+08:00",
    });

    await expect(
      recordPayment(managerActor, benLeaseId, {
        amountSen: 1,
        method: "cash",
        receivedAt: "2027-03-01T10:05:00+08:00",
      }),
    ).rejects.toMatchObject({ status: 422 });

    await voidRoute(
      authRequest(
        `http://localhost/api/payments/${payment.id}/void`,
        managerToken,
        {
          method: "POST",
          body: JSON.stringify({ reason: "restore balance" }),
        },
      ),
      { params: Promise.resolve({ paymentId: payment.id }) },
    );

    const restored = await recordPayment(managerActor, benLeaseId, {
      amountSen: Math.min(1_000, remaining),
      method: "cash",
      receivedAt: "2027-03-01T10:10:00+08:00",
    });
    expect(restored.status).toBe("approved");

    await voidRoute(
      authRequest(
        `http://localhost/api/payments/${restored.id}/void`,
        managerToken,
        {
          method: "POST",
          body: JSON.stringify({ reason: "test cleanup restore" }),
        },
      ),
      { params: Promise.resolve({ paymentId: restored.id }) },
    );
  });

  afterAll(async () => {
    // Remove any leftover online fixtures on Ben so seed balances stay usable.
    const online = await prisma.payment.findMany({
      where: { leaseId: benLeaseId, method: "online" },
      select: { gatewayBillId: true },
    });
    for (const payment of online) {
      if (payment.gatewayBillId) {
        await deleteGatewayBillCascade(payment.gatewayBillId);
      }
    }
  });
});
