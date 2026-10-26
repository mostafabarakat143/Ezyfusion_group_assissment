import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAdminClient } from "../src/lib/supabase/admin";
import { prisma } from "../src/lib/prisma";
import { createLease } from "../src/lib/leases";
import { approvePayment, getCollectionsReport, recordPayment } from "../src/lib/payments";
import { parseRinggitToSen } from "../src/lib/billing";
import type { Actor } from "../src/lib/auth";
import { SEED_PASSWORD } from "../src/lib/seed-constants";

export { SEED_PASSWORD };

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }
}

async function ensureUser(email: string, fullName: string) {
  const admin = createAdminClient();
  const listed = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  const existing = listed.data.users.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return existing.id;
  }

  const created = await admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Failed to create ${email}`);
  }
  return created.data.user.id;
}

async function main() {
  loadEnvFiles();

  console.log("Seeding auth users, organizations, leases and payments...");

  const northwindManagerId = await ensureUser(
    "manager@northwind.test",
    "Northwind Manager",
  );
  const northwindStaffId = await ensureUser(
    "staff@northwind.test",
    "Northwind Staff",
  );
  const aisyahUserId = await ensureUser("aisyah@northwind.test", "Aisyah Rahman");
  const benUserId = await ensureUser("ben@northwind.test", "Ben Lim");
  const probeUserId = await ensureUser("probe@northwind.test", "Probe Tenant");
  const betaManagerId = await ensureUser("manager@beta.test", "Beta Manager");
  const chenUserId = await ensureUser("chen@beta.test", "Chen Wei");

  // audit_log is append-only (no UPDATE/DELETE/TRUNCATE, including for the DB owner).
  // It intentionally has no FK to organizations so this CASCADE cannot wipe history.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      payment_allocations,
      payments,
      gateway_bills,
      invoices,
      leases,
      tenants,
      units,
      memberships,
      organizations
    RESTART IDENTITY CASCADE
  `);

  const northwind = await prisma.organization.create({
    data: { name: "Northwind Properties" },
  });
  const beta = await prisma.organization.create({
    data: { name: "Beta Realty" },
  });

  await prisma.membership.createMany({
    data: [
      { userId: northwindManagerId, orgId: northwind.id, role: "manager" },
      { userId: northwindStaffId, orgId: northwind.id, role: "staff" },
      { userId: betaManagerId, orgId: beta.id, role: "manager" },
    ],
  });

  const [unitA, unitB, unitC, unitD, unitKl] = await Promise.all([
    prisma.unit.create({ data: { orgId: northwind.id, name: "A-12-3" } }),
    prisma.unit.create({ data: { orgId: northwind.id, name: "B-05-1" } }),
    prisma.unit.create({ data: { orgId: northwind.id, name: "C-01-7" } }),
    prisma.unit.create({ data: { orgId: northwind.id, name: "D-03-2" } }),
    prisma.unit.create({ data: { orgId: beta.id, name: "KL-1" } }),
  ]);

  const [aisyah, ben, probe, chen] = await Promise.all([
    prisma.tenant.create({
      data: {
        orgId: northwind.id,
        userId: aisyahUserId,
        fullName: "Aisyah Rahman",
        email: "aisyah@northwind.test",
        phone: "+60111111111",
      },
    }),
    prisma.tenant.create({
      data: {
        orgId: northwind.id,
        userId: benUserId,
        fullName: "Ben Lim",
        email: "ben@northwind.test",
        phone: "+60112222222",
      },
    }),
    prisma.tenant.create({
      data: {
        orgId: northwind.id,
        userId: probeUserId,
        fullName: "Probe Tenant",
        email: "probe@northwind.test",
        phone: "+60113333333",
      },
    }),
    prisma.tenant.create({
      data: {
        orgId: beta.id,
        userId: chenUserId,
        fullName: "Chen Wei",
        email: "chen@beta.test",
        phone: "+60114444444",
      },
    }),
  ]);

  const northwindManager: Actor = {
    kind: "membership",
    userId: northwindManagerId,
    orgId: northwind.id,
    role: "manager",
  };
  const northwindStaff: Actor = {
    kind: "membership",
    userId: northwindStaffId,
    orgId: northwind.id,
    role: "staff",
  };
  const betaManager: Actor = {
    kind: "membership",
    userId: betaManagerId,
    orgId: beta.id,
    role: "manager",
  };

  const aisyahLease = await createLease(northwindManager, {
    unitId: unitA.id,
    tenantId: aisyah.id,
    startDate: "2026-01-31",
    endDate: "2026-07-15",
    monthlyRentSen: parseRinggitToSen("1,500.00"),
    depositSen: parseRinggitToSen("3,000.00"),
  });

  await createLease(northwindManager, {
    unitId: unitB.id,
    tenantId: ben.id,
    startDate: "2026-01-01",
    endDate: "2026-04-15",
    monthlyRentSen: parseRinggitToSen("1,000.29"),
    depositSen: 0,
  });

  await createLease(northwindManager, {
    unitId: unitC.id,
    tenantId: probe.id,
    startDate: "2026-02-28",
    endDate: "2027-02-27",
    monthlyRentSen: parseRinggitToSen("2,000.00"),
    depositSen: parseRinggitToSen("4,000.00"),
  });

  await createLease(betaManager, {
    unitId: unitKl.id,
    tenantId: chen.id,
    startDate: "2026-03-15",
    endDate: "2027-03-14",
    monthlyRentSen: parseRinggitToSen("2,200.00"),
    depositSen: parseRinggitToSen("4,400.00"),
  });

  await recordPayment(northwindManager, aisyahLease.id, {
    amountSen: parseRinggitToSen("3,000.00"),
    method: "cash",
    receivedAt: "2026-01-31T10:00:00+08:00",
  });

  const slipPath = `${northwind.id}/aisyah-bank-transfer.png`;
  const admin = createAdminClient();
  const upload = await admin.storage
    .from("payment-slips")
    .upload(slipPath, TINY_PNG, {
      contentType: "image/png",
      upsert: true,
    });
  if (upload.error) throw upload.error;

  const bankTransfer = await recordPayment(northwindStaff, aisyahLease.id, {
    amountSen: parseRinggitToSen("2,000.00"),
    method: "bank_transfer",
    receivedAt: "2026-03-01T00:30:00+08:00",
    slipPath,
  });

  await approvePayment(northwindManager, bankTransfer.id);

  const collections = await getCollectionsReport(
    northwindManager,
    "2026-01",
    "2026-03",
  );

  console.log(
    JSON.stringify(
      {
        password: SEED_PASSWORD,
        northwindOrgId: northwind.id,
        betaOrgId: beta.id,
        units: {
          "A-12-3": unitA.id,
          "B-05-1": unitB.id,
          "C-01-7": unitC.id,
          "D-03-2": unitD.id,
          "KL-1": unitKl.id,
        },
        tenants: {
          aisyah: aisyah.id,
          ben: ben.id,
          probe: probe.id,
          chen: chen.id,
        },
        aisyahLeaseId: aisyahLease.id,
        collections,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
