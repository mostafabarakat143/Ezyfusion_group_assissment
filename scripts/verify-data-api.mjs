/**
 * Live Data API / Storage checks with seeded Bearer tokens.
 * Run after: supabase start, db reset, npm run seed.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = "SeedPassword123!";

if (!url || !anon) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or publishable key");
  process.exit(1);
}

async function tokenFor(email) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw error ?? new Error(`No session for ${email}`);
  }
  return { accessToken: data.session.access_token, client };
}

function userClient(accessToken) {
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error("FAIL:", message);
  } else {
    console.log("OK:", message);
  }
}

const anonClient = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: anonOrgs, error: anonOrgError } = await anonClient
  .from("organizations")
  .select("id");
assert(
  (anonOrgs?.length ?? 0) === 0 || anonOrgError,
  "anon cannot read organizations via Data API",
);

const { data: anonInsert, error: anonInsertError } = await anonClient
  .from("organizations")
  .insert({ name: "Hacker Org" })
  .select();
assert(
  anonInsertError || (anonInsert?.length ?? 0) === 0,
  "anon cannot insert organizations",
);

const manager = await tokenFor("manager@northwind.test");
const tenant = await tokenFor("aisyah@northwind.test");
const betaManager = await tokenFor("manager@beta.test");

const managerDb = userClient(manager.accessToken);
const tenantDb = userClient(tenant.accessToken);
const betaDb = userClient(betaManager.accessToken);

const { data: managerOrgs } = await managerDb.from("organizations").select("name");
assert(
  (managerOrgs ?? []).some((row) => row.name === "Northwind Properties") &&
    !(managerOrgs ?? []).some((row) => row.name === "Beta Realty"),
  "manager sees only own organization",
);

const { data: tenantMemberships } = await tenantDb.from("memberships").select("*");
assert(
  (tenantMemberships?.length ?? 0) === 0,
  "tenant cannot read memberships",
);

const { data: aisyahRow } = await tenantDb
  .from("tenants")
  .select("id, phone, full_name")
  .eq("email", "aisyah@northwind.test")
  .single();

const newPhone = `+6011${Date.now().toString().slice(-7)}`;
const { error: phoneError } = await tenantDb
  .from("tenants")
  .update({ phone: newPhone })
  .eq("id", aisyahRow.id);
assert(!phoneError, "tenant can update own phone via supabase-js");

const { data: phoneCheck } = await tenantDb
  .from("tenants")
  .select("phone")
  .eq("id", aisyahRow.id)
  .single();
assert(phoneCheck?.phone === newPhone, "tenant phone update persisted");

const { data: nameHack, error: nameHackError } = await tenantDb
  .from("tenants")
  .update({ full_name: "Hacked" })
  .eq("id", aisyahRow.id)
  .select();
assert(
  nameHackError ||
    !nameHack?.length ||
    nameHack[0].full_name !== "Hacked",
  "tenant cannot change full_name (column grant / RLS)",
);

const { data: crossTenant } = await tenantDb
  .from("tenants")
  .select("id")
  .eq("email", "ben@northwind.test");
assert((crossTenant?.length ?? 0) === 0, "tenant cannot read other tenant rows");

const { data: betaLeases } = await managerDb.from("leases").select("id");
const { data: northFromBeta } = await betaDb.from("leases").select("id");
assert(
  (betaLeases?.length ?? 0) > 0 &&
    !(northFromBeta ?? []).some((row) =>
      (betaLeases ?? []).some((own) => own.id === row.id),
    ),
  "managers cannot see other org leases",
);

const orgId = (await managerDb.from("organizations").select("id").single()).data
  .id;
const slipPath = `${orgId}/aisyah-bank-transfer.png`;

// TASK §6: staff/managers must not read slips via direct Storage SELECT — only
// short-lived signed URLs from the server (service role).
const { data: managerList, error: managerListError } = await managerDb.storage
  .from("payment-slips")
  .list(orgId);
assert(
  managerListError || (managerList?.length ?? 0) === 0,
  "manager cannot list payment-slips via user JWT (signed-URL-only reads)",
);

const { data: managerSlip, error: managerSlipError } = await managerDb.storage
  .from("payment-slips")
  .createSignedUrl(slipPath, 30);
assert(
  managerSlipError || !managerSlip?.signedUrl,
  "manager cannot mint Storage signed URLs with user JWT",
);

const { data: managerDownload, error: managerDownloadError } =
  await managerDb.storage.from("payment-slips").download(slipPath);
assert(
  managerDownloadError || !managerDownload,
  "manager cannot download slips via user JWT",
);

const { data: slipPayments } = await managerDb
  .from("payments")
  .select("id")
  .eq("slip_path", slipPath)
  .limit(1);
assert(
  (slipPayments?.length ?? 0) === 1,
  "seeded bank-transfer payment with slip exists",
);

// App API uses service role to mint a short-lived signed URL after authz.
const appBase = process.env.APP_URL ?? "http://127.0.0.1:3000";
const paymentId = slipPayments[0].id;
try {
  const slipRes = await fetch(`${appBase}/api/payments/${paymentId}/slip`, {
    redirect: "manual",
    headers: { Authorization: `Bearer ${manager.accessToken}` },
  });
  if (
    slipRes.status === 302 ||
    slipRes.status === 307 ||
    slipRes.status === 200
  ) {
    console.log("OK: manager slip access via app signed-URL route");
  } else if (slipRes.status === 0 || slipRes.type === "error") {
    console.log(
      "SKIP: slip API (start the app to verify GET /api/payments/:id/slip)",
    );
  } else {
    assert(
      false,
      `manager slip API expected redirect, got ${slipRes.status}`,
    );
  }
} catch {
  console.log(
    "SKIP: slip API (start the app to verify GET /api/payments/:id/slip)",
  );
}

const { data: tenantList, error: tenantListError } = await tenantDb.storage
  .from("payment-slips")
  .list(orgId);
assert(
  tenantListError || (tenantList?.length ?? 0) === 0,
  "tenant cannot list payment-slips",
);

const { data: tenantSigned, error: tenantSignedError } = await tenantDb.storage
  .from("payment-slips")
  .createSignedUrl(slipPath, 30);
assert(
  tenantSignedError || !tenantSigned?.signedUrl,
  "tenant cannot create signed URL for slips",
);

const { data: betaSigned, error: betaSignedError } = await betaDb.storage
  .from("payment-slips")
  .createSignedUrl(slipPath, 30);
assert(
  betaSignedError || !betaSigned?.signedUrl,
  "other-org manager cannot sign Northwind slips",
);

const { data: anonSlip, error: anonSlipError } = await anonClient.storage
  .from("payment-slips")
  .createSignedUrl(slipPath, 30);
assert(
  anonSlipError || !anonSlip?.signedUrl,
  "anon cannot sign payment-slips",
);

if (failures.length) {
  console.error(`\n${failures.length} Data API/Storage check(s) failed`);
  process.exit(1);
}

console.log("\nAll Data API / Storage Bearer checks passed");
