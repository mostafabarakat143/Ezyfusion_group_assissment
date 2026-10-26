import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { POST as createLeaseRoute } from "@/app/api/leases/route";
import { GET as getLeaseRoute } from "@/app/api/leases/[leaseId]/route";
import { POST as recordPaymentRoute } from "@/app/api/leases/[leaseId]/payments/route";
import { POST as approvePaymentRoute } from "@/app/api/payments/[paymentId]/approve/route";
import { POST as voidPaymentRoute } from "@/app/api/payments/[paymentId]/void/route";
import { GET as collectionsRoute } from "@/app/api/reports/collections/route";
import { prisma } from "@/lib/prisma";
import { SEED_PASSWORD } from "@/lib/seed-constants";
import { recordPayment } from "@/lib/payments";
import type { Actor } from "@/lib/auth";

async function deleteLeaseCascade(leaseId: string) {
  await prisma.paymentAllocation.deleteMany({
    where: { payment: { leaseId } },
  });
  await prisma.payment.deleteMany({ where: { leaseId } });
  await prisma.gatewayBill.deleteMany({ where: { leaseId } });
  await prisma.invoice.deleteMany({ where: { leaseId } });
  await prisma.lease.deleteMany({ where: { id: leaseId } });
}

async function clearUnitLeases(unitId: string) {
  const leases = await prisma.lease.findMany({
    where: { unitId },
    select: { id: true },
  });
  for (const lease of leases) {
    await deleteLeaseCascade(lease.id);
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

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

function authRequest(
  url: string,
  token: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(url, { ...init, headers });
}

describe("API integration", () => {
  let northwindManagerToken: string;
  let northwindStaffToken: string;
  let betaManagerToken: string;
  let aisyahToken: string;
  let benToken: string;
  let northwindOrgId: string;
  let aisyahLeaseId: string;
  let benLeaseId: string;
  let probeTenantId: string;
  let vacantUnitId: string;
  let probeLeaseId: string;

  beforeAll(async () => {
    northwindManagerToken = await signIn("manager@northwind.test");
    northwindStaffToken = await signIn("staff@northwind.test");
    betaManagerToken = await signIn("manager@beta.test");
    aisyahToken = await signIn("aisyah@northwind.test");
    benToken = await signIn("ben@northwind.test");

    const northwind = await prisma.organization.findFirstOrThrow({
      where: { name: "Northwind Properties" },
    });
    northwindOrgId = northwind.id;

    const aisyah = await prisma.tenant.findFirstOrThrow({
      where: { email: "aisyah@northwind.test" },
    });
    const ben = await prisma.tenant.findFirstOrThrow({
      where: { email: "ben@northwind.test" },
    });
    const probe = await prisma.tenant.findFirstOrThrow({
      where: { email: "probe@northwind.test" },
    });
    probeTenantId = probe.id;

    const aisyahLease = await prisma.lease.findFirstOrThrow({
      where: { tenantId: aisyah.id },
    });
    const benLease = await prisma.lease.findFirstOrThrow({
      where: { tenantId: ben.id },
    });
    const probeLease = await prisma.lease.findFirstOrThrow({
      where: { tenantId: probe.id },
    });
    aisyahLeaseId = aisyahLease.id;
    benLeaseId = benLease.id;
    probeLeaseId = probeLease.id;

    const vacant = await prisma.unit.findFirstOrThrow({
      where: { orgId: northwind.id, name: "D-03-2" },
    });
    vacantUnitId = vacant.id;
  }, 60_000);

  it("returns 401 without authentication", async () => {
    const response = await getLeaseRoute(
      new Request(`http://localhost/api/leases/${aisyahLeaseId}`),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(response.status).toBe(401);
  });

  it("hides cross-organization leases with 404", async () => {
    const response = await getLeaseRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}`,
        betaManagerToken,
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(response.status).toBe(404);
  });

  it("hides another tenant's lease with 404", async () => {
    const response = await getLeaseRoute(
      authRequest(`http://localhost/api/leases/${benLeaseId}`, aisyahToken),
      { params: Promise.resolve({ leaseId: benLeaseId }) },
    );
    expect(response.status).toBe(404);
  });

  it("forbids staff from creating leases with 403", async () => {
    const response = await createLeaseRoute(
      authRequest("http://localhost/api/leases", northwindStaffToken, {
        method: "POST",
        body: JSON.stringify({
          unitId: vacantUnitId,
          tenantId: probeTenantId,
          startDate: "2027-03-01",
          endDate: "2027-03-31",
          monthlyRentSen: 100_000,
          depositSen: 0,
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("hides cross-org payment actions with 404 before role 403", async () => {
    const northwindPayment = await prisma.payment.findFirstOrThrow({
      where: { leaseId: aisyahLeaseId, status: "approved" },
    });

    const staffCrossOrg = await approvePaymentRoute(
      authRequest(
        `http://localhost/api/payments/${northwindPayment.id}/approve`,
        betaManagerToken,
        { method: "POST" },
      ),
      { params: Promise.resolve({ paymentId: northwindPayment.id }) },
    );
    expect(staffCrossOrg.status).toBe(404);

    const tenantForeignLease = await recordPaymentRoute(
      authRequest(
        `http://localhost/api/leases/${benLeaseId}/payments`,
        aisyahToken,
        {
          method: "POST",
          body: JSON.stringify({
            amountSen: 1_000,
            method: "cash",
            receivedAt: "2027-01-01T10:00:00+08:00",
          }),
        },
      ),
      { params: Promise.resolve({ leaseId: benLeaseId }) },
    );
    expect(tenantForeignLease.status).toBe(404);

    const tenantOwnLease = await recordPaymentRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}/payments`,
        aisyahToken,
        {
          method: "POST",
          body: JSON.stringify({
            amountSen: 1_000,
            method: "cash",
            receivedAt: "2027-01-01T10:00:00+08:00",
          }),
        },
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(tenantOwnLease.status).toBe(403);

    const staffOwnOrgApprove = await approvePaymentRoute(
      authRequest(
        `http://localhost/api/payments/${northwindPayment.id}/approve`,
        northwindStaffToken,
        { method: "POST" },
      ),
      { params: Promise.resolve({ paymentId: northwindPayment.id }) },
    );
    expect(staffOwnOrgApprove.status).toBe(403);
  });

  it("returns Aisyah's lease with allocation order, paidSen and statuses", async () => {
    const response = await getLeaseRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}`,
        aisyahToken,
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lease.monthlyRentSen).toBe(150_000);
    expect(body.lease.depositSen).toBe(300_000);
    expect(typeof body.lease.monthlyRentSen).toBe("number");
    expect(body.invoices[0]).toMatchObject({
      kind: "deposit",
      periodIndex: null,
      amountSen: 300_000,
      paidSen: 300_000,
      status: "paid",
    });
    expect(body.invoices[1]).toMatchObject({
      kind: "rent",
      periodIndex: 0,
      amountSen: 150_000,
      paidSen: 150_000,
      status: "paid",
    });
    expect(body.invoices[2]).toMatchObject({
      kind: "rent",
      periodIndex: 1,
      amountSen: 150_000,
      paidSen: 50_000,
    });
    expect(body.invoices.at(-1)).toMatchObject({
      periodIndex: 5,
      amountSen: 77_419,
    });
    expect(body.payments).toHaveLength(2);
    expect(body.payments[0].method).toBe("cash");
    expect(body.payments[1].method).toBe("bank_transfer");
    expect(body.payments[1].status).toBe("approved");
  });

  it("rejects overlapping lease creation with 409, including concurrency", async () => {
    // Seed leaves D-03-2 vacant; clear any leftover fixtures from prior runs.
    await clearUnitLeases(vacantUnitId);

    const payload = {
      unitId: vacantUnitId,
      tenantId: probeTenantId,
      startDate: "2028-01-01",
      endDate: "2028-06-30",
      monthlyRentSen: 120_000,
      depositSen: 0,
    };

    const first = await createLeaseRoute(
      authRequest("http://localhost/api/leases", northwindManagerToken, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(first.status).toBe(201);
    const created = await first.json();

    const overlap = await createLeaseRoute(
      authRequest("http://localhost/api/leases", northwindManagerToken, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          startDate: "2028-06-01",
          endDate: "2028-12-31",
        }),
      }),
    );
    expect(overlap.status).toBe(409);

    const concurrentPayload = {
      unitId: vacantUnitId,
      tenantId: probeTenantId,
      startDate: "2029-01-01",
      endDate: "2029-03-31",
      monthlyRentSen: 100_000,
      depositSen: 0,
    };
    await deleteLeaseCascade(created.id);

    const results = await Promise.all([
      createLeaseRoute(
        authRequest("http://localhost/api/leases", northwindManagerToken, {
          method: "POST",
          body: JSON.stringify(concurrentPayload),
        }),
      ),
      createLeaseRoute(
        authRequest("http://localhost/api/leases", northwindManagerToken, {
          method: "POST",
          body: JSON.stringify(concurrentPayload),
        }),
      ),
    ]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([201, 409]);

    const winner = results.find((result) => result.status === 201);
    if (winner) {
      const body = await winner.json();
      await deleteLeaseCascade(body.id);
    }
    await clearUnitLeases(vacantUnitId);
  });

  it("allocates payments in due-date / deposit / period order", async () => {
    const response = await getLeaseRoute(
      authRequest(
        `http://localhost/api/leases/${aisyahLeaseId}`,
        northwindManagerToken,
      ),
      { params: Promise.resolve({ leaseId: aisyahLeaseId }) },
    );
    const body = await response.json();
    // Cash 300000 fills deposit. Bank transfer 200000 fills rent0 (150000) and 50000 of rent1.
    expect(body.invoices.map((row: { paidSen: number }) => row.paidSen)).toEqual([
      300_000, 150_000, 50_000, 0, 0, 0, 0,
    ]);
  });

  it("prevents concurrent payments from exceeding the cap", async () => {
    const manager = await prisma.membership.findFirstOrThrow({
      where: { orgId: northwindOrgId, role: "manager" },
    });
    const actor: Actor = {
      kind: "membership",
      userId: manager.userId,
      orgId: northwindOrgId,
      role: "manager",
    };

    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: probeLeaseId },
      include: { invoices: true },
    });
    const total = lease.invoices.reduce(
      (sum, invoice) => sum + Number(invoice.amountSen),
      0,
    );

    // Restore a clean remaining balance if a prior run left probe fully paid.
    const existing = await prisma.payment.findMany({
      where: { leaseId: probeLeaseId, status: "approved" },
    });
    for (const payment of existing) {
      await prisma.paymentAllocation.deleteMany({
        where: { paymentId: payment.id },
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "voided", unappliedSen: 0n },
      });
    }

    const results = await Promise.allSettled([
      recordPayment(actor, probeLeaseId, {
        amountSen: total,
        method: "cash",
        receivedAt: "2027-06-01T10:00:00+08:00",
      }),
      recordPayment(actor, probeLeaseId, {
        amountSen: 100_000,
        method: "cash",
        receivedAt: "2027-06-01T10:01:00+08:00",
      }),
    ]);

    const fulfilled = results.filter((row) => row.status === "fulfilled");
    const rejected = results.filter((row) => row.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (fulfilled[0]?.status === "fulfilled") {
      await voidPaymentRoute(
        authRequest(
          `http://localhost/api/payments/${fulfilled[0].value.id}/void`,
          northwindManagerToken,
          {
            method: "POST",
            body: JSON.stringify({ reason: "test cleanup restore" }),
          },
        ),
        { params: Promise.resolve({ paymentId: fulfilled[0].value.id }) },
      );
    }
  });

  it("reports Northwind collections for Jan–Mar 2026", async () => {
    const response = await collectionsRoute(
      authRequest(
        "http://localhost/api/reports/collections?from=2026-01&to=2026-03",
        northwindManagerToken,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { month: "2026-01", collectedSen: 300_000 },
      { month: "2026-02", collectedSen: 0 },
      { month: "2026-03", collectedSen: 200_000 },
    ]);
  });

  it("rejects invalid collection month ranges with 400", async () => {
    const badMonth = await collectionsRoute(
      authRequest(
        "http://localhost/api/reports/collections?from=2026-13&to=2026-14",
        northwindManagerToken,
      ),
    );
    expect(badMonth.status).toBe(400);

    const inverted = await collectionsRoute(
      authRequest(
        "http://localhost/api/reports/collections?from=2026-03&to=2026-01",
        northwindManagerToken,
      ),
    );
    expect(inverted.status).toBe(400);
  });

  it("rejects non-UUID lease ids with 400", async () => {
    const response = await getLeaseRoute(
      authRequest("http://localhost/api/leases/not-a-uuid", aisyahToken),
      { params: Promise.resolve({ leaseId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
  });

  it("records staff payments as pending until manager approval", async () => {
    const lease = await prisma.lease.findFirstOrThrow({
      where: { tenant: { email: "ben@northwind.test" } },
      include: {
        invoices: true,
        payments: true,
      },
    });
    const paid = await prisma.paymentAllocation.aggregate({
      where: { invoice: { leaseId: lease.id } },
      _sum: { amountSen: true },
    });
    const total = lease.invoices.reduce(
      (sum, invoice) => sum + Number(invoice.amountSen),
      0,
    );
    const remaining = total - Number(paid._sum.amountSen ?? 0n);
    expect(remaining).toBeGreaterThan(0);

    const pending = await recordPaymentRoute(
      authRequest(
        `http://localhost/api/leases/${lease.id}/payments`,
        northwindStaffToken,
        {
          method: "POST",
          body: JSON.stringify({
            amountSen: Math.min(10_000, remaining),
            method: "cash",
            receivedAt: "2027-01-15T09:00:00+08:00",
          }),
        },
      ),
      { params: Promise.resolve({ leaseId: lease.id }) },
    );
    expect(pending.status).toBe(201);
    const pendingBody = await pending.json();
    expect(pendingBody.status).toBe("pending_verification");

    const approved = await approvePaymentRoute(
      authRequest(
        `http://localhost/api/payments/${pendingBody.id}/approve`,
        northwindManagerToken,
        { method: "POST" },
      ),
      { params: Promise.resolve({ paymentId: pendingBody.id }) },
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ status: "approved" });

    await voidPaymentRoute(
      authRequest(
        `http://localhost/api/payments/${pendingBody.id}/void`,
        northwindManagerToken,
        {
          method: "POST",
          body: JSON.stringify({ reason: "test cleanup restore" }),
        },
      ),
      { params: Promise.resolve({ paymentId: pendingBody.id }) },
    );
  });
});
