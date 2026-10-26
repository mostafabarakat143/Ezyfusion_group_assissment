# EzyFusion — Rent Collection Assessment

Next.js 16 App Router + TypeScript + local Supabase (Postgres, Auth, Storage) + Prisma + shadcn/ui + Tailwind.

Shared seed password: **`SeedPassword123!`**  
Primary test account: **`manager@northwind.test`**

## Prerequisites

- Node.js 20+
- Docker (for local Supabase)
- npm

## Setup

```bash
npx supabase start
npx supabase db reset
npm install
cp .env.example .env.local
# Confirm keys with: npx supabase status
npm run seed          # runs `prisma generate` then seeds
npm run build && npm start   # `build` also runs `prisma generate`
```

`prisma generate` is wired into `seed`, `build`, `dev`, and `test` so a fresh clone works without a manual generate step. `prisma.config.ts` loads `.env.local` before `.env` so `DATABASE_URL` is present after the grader’s `cp .env.example .env.local`.

App: [http://localhost:3000](http://localhost:3000)

### Environment

See `.env.example`. Required variables:

| Variable | Source |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | `npx supabase status` DB URL |
| `NEXT_PUBLIC_SUPABASE_URL` | API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon / publishable key |
| `SUPABASE_SECRET_KEY` | service_role key (server only) |
| `GATEWAY_X_SIGNATURE_KEY` | local webhook HMAC secret (`test_x_signature_key`) |

Never commit `.env` / `.env.local`. Never expose `SUPABASE_SECRET_KEY` to the browser.

## Tests

```bash
npm test                 # billing + API/gateway integration tests
npm run test:billing:zones   # billing under UTC, Asia/Kuala_Lumpur, America/New_York
npx supabase db reset && npm run seed
npm run build
```

Gateway simulator (server must be running):

```bash
set GATEWAY_X_SIGNATURE_KEY=test_x_signature_key
node gateway-sim.mjs <bill_id> <amount_sen> true
```

## What works

- Pure billing in `src/lib/billing.ts` (`generateSchedule`, `invoiceStatus`, `parseRinggitToSen`)
- Schema + RLS + private `payment-slips` bucket via `supabase/migrations/`
- Lease create/get, payments (record/approve/reject/void), collections report, gateway bills + webhook
- Seed data from `TASK.md` §2 through normal lease/payment code paths
- UI: login, manager/staff dashboard & leases, payment recording with slip upload cleanup on failure, approve/reject/void dialogs, tenant portal (phone via supabase-js), Pay now, read-only `/payments/return`
- Bonus: manager create-lease form with live `generateSchedule` preview (`/leases/new`)
- Bonus: tenant portal Realtime refresh on payment/invoice/allocation changes
- Bonus: pure `allocatePaymentAmounts` unit tests in `src/lib/allocation.test.ts`
- Bonus: server-side lease search + pagination via `?q=` and `?page=` on `/leases`
- `REVIEW.md`, `DECISIONS.md`, `ai-logs/` instructions

## Seeded accounts

All use `SeedPassword123!`.

| Email | Role |
|---|---|
| manager@northwind.test | manager |
| staff@northwind.test | staff |
| aisyah@northwind.test | tenant |
| ben@northwind.test | tenant |
| probe@northwind.test | tenant |
| manager@beta.test | manager |
| chen@beta.test | tenant |

## Known limitations / skipped

- Prisma uses the DB owner connection (bypasses RLS); every server path enforces authz in code. Data API RLS still protects direct PostgREST access. `auto_expose_new_tables = false`; function EXECUTE is revoked from `PUBLIC`/`anon` and granted only where needed.
- Realtime requires the `20261026130000_realtime_publication` migration (`npx supabase db reset` or apply migrations).
- Payment slips: staff/managers upload with their JWT; reads go only through `GET /api/payments/:id/slip` (service-role signed URL). Storage has no authenticated SELECT policy. Failed API recordings delete the uploaded slip server-side.
- `audit_log` is append-only (UPDATE/DELETE/TRUNCATE blocked, including for the DB owner). It has no FK to `organizations` so truncating orgs cannot wipe history.
- During `next build`, Cache Components may log prerender bail-outs for API routes that read `request.headers` (for example `/api/reports/collections`). Those routes still compile as dynamic (`ƒ`) and the build exits 0.
- Auth UI pages use `<Suspense>` + `connection()` so Malaysia-time dashboards are not prerendered with the wrong user/time.
- Optional live Data API check: `node scripts/verify-data-api.mjs` (after seed). SQL shape check: pipe `scripts/verify-rls.sql` into `psql`.

## Project layout

- `TASK.md` — assessment brief (source of truth)
- `src/lib/` — billing, auth, leases, payments, gateway
- `src/app/api/` — HTTP API
- `src/app/` — UI routes
- `supabase/migrations/` — database source of truth
- `scripts/seed.ts` — `npm run seed`
- `gateway-sim.mjs` — webhook simulator

## AI logs

See `ai-logs/README.md`. Export complete Cursor chat transcripts into that folder for submission; do not fabricate or edit them.
