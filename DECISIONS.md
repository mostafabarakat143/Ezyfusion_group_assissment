# Part C — Decisions

Each answer is ≤150 words and points at this repository.

## 1. Duplicate paid=true callbacks 5 ms apart

Both requests enter `handleGatewayWebhook` in `src/lib/gateway.ts`. Each opens a transaction and runs `SELECT … FOR UPDATE` on `gateway_bills` (lines 155–161). An already-paid bill returns 200 at lines 172–174 before amount checks. Otherwise the first lock holder marks the bill `paid`, inserts one `payments` row with `gatewayBillId`, and allocates. The second waiter re-reads after the lease lock; `fresh.status === "paid"` returns 200 with no insert (lines 197–199). If two inserts race past the status check, `payments.gateway_bill_id` uniqueness plus the P2002 handler (lines 253–257) still yields a single payment.

## 2. Concurrent RM 800 and RM 700 on RM 1,000 remaining

`recordPayment` in `src/lib/payments.ts` locks the lease with `SELECT … FOR UPDATE` (lines 21–27; called at line 209). Cap math is `availableCap = remainingBalance - pendingTotal` (lines 59–66). The first transaction that holds the lock sees cap 100000, accepts 80000, and inserts pending/approved. The second then recomputes cap (20000) and throws 422 at lines 217–219. Both cannot commit over the cap because the lease row lock serializes balance checks.

## 3. Where “today” / date↔instant conversions happen

- `src/lib/billing.ts` `invoiceStatus` / `malaysiaCivilDate` (≈122, 249–254): Asia/Kuala_Lumpur for overdue.
- `src/lib/dates.ts` `malaysiaCivilDate`, `formatMalaysiaDateTime`, `parseInstant` (29–66, 73): MYT display and requiring explicit offsets on inputs.
- `src/lib/gateway.ts` `createGatewayBill` today (98) and `parseGatewayPaidAt` (51–64, 186): MYT due cutoff; gateway `+0800` paid_at → timestamptz.
- `src/lib/payments.ts` `parseInstant` for `receivedAt` (≈181): caller must send MYT offset.
- `src/lib/dashboard.ts` collections window / `amountDueNow` (16, 106): MYT civil dates.
- SQL collections: `received_at AT TIME ZONE 'Asia/Kuala_Lumpur'` in `getCollectionsReport` (`src/lib/payments.ts` 457–495), including empty months.

Host TZ is never used for business days.

## 4. Queries not subject to RLS

Prisma uses `DATABASE_URL` as the Postgres owner (`src/lib/prisma.ts`), so it bypasses RLS. Authorization is `requireActor` / `requirePageActor` plus explicit `orgId` / `tenantId` checks in `src/lib/auth.ts`, `leases.ts`, `payments.ts`, `gateway.ts`. The service-role client (`src/lib/supabase/admin.ts`) is seed/signed-URL only; browser never receives it. `SECURITY DEFINER` helpers in `supabase/migrations/20261026120000_billing_schema.sql` (`current_org_ids`, `is_manager`, `is_staff_or_manager`, `is_tenant`, `tenant_lease_ids`) only support Data API RLS; they do not replace server checks for Prisma paths. Execute is revoked from `PUBLIC`/`anon` and granted only to `authenticated`.

## 5. Void while unapplied_sen remains on an online payment

`voidPayment` (`src/lib/payments.ts` 400–452) deletes only that payment’s `payment_allocations`, sets status `voided`, and zeroes its `unappliedSen`. Other payments’ allocations and any other payment’s unapplied balance are untouched. Invoices become unpaid again for the voided amount only. We do not auto-reallocate leftover unapplied from a different online payment onto the reopened invoices: reallocating silently would surprise operators and race with new recordings. Staff/managers can record a new payment (or tenants pay online) against the restored remaining balance.

## 6. Two real AI mistakes (from this Cursor work)

1. **Wrong first billing/schema draft:** The assistant initially implemented calendar-month proration and non-spec table names (`organization_members`, draft invoice statuses) instead of `TASK.md` §3/`generateSchedule` and §8. Caught when the brief was added as `TASK.md` and Aisyah’s final amount had to be exactly 77419. Corrected in `src/lib/billing.ts` and the Supabase migration. See `ai-logs/README.md` for exporting the session transcript that contains that correction.
2. **Gateway tests polluted seed allocations:** Settlement tests inserted online payments on Aisyah’s lease, so integration expectations `300000/150000/50000` failed. Noticed in `npm test` output (`paidSen: 101000`). Fixed by pointing webhook settlement fixtures at Ben’s lease in `src/lib/gateway.test.ts`.

Do not invent other mistakes; export full Cursor transcripts into `ai-logs/` as described there.
