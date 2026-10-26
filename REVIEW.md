# Part B — Code Review

Ordered most severe to least severe. Line numbers refer to the pull-request snippets in `TASK.md` Part B.

## 1. Trusts `user_metadata.role` for authorization — Critical

**Lines:** `late-fees/route.ts` 318–320

**What goes wrong:** The handler allows the request if `user.user_metadata.role === 'manager'`. Clients can set or alter `user_metadata` through Supabase Auth APIs. A staff or tenant account that writes `role: "manager"` into metadata can create late-fee invoices for any lease id they know.

**Fix:** Resolve the role from `memberships` (and never from metadata), the same way production auth does. After `getUser()`, look up `memberships.user_id` and require `role = 'manager'`. Also scope the lease to that membership’s `org_id` before mutating.

## 2. No organization check on the lease — Critical

**Lines:** `late-fees/route.ts` 323–327

**What goes wrong:** The lease is loaded by id only. Even with a correct manager check, a Northwind manager who learns a Beta lease id can attach late fees to another organization’s invoices. The brief requires cross-org access to return 404 without revealing existence.

**Fix:** After loading the lease, require `lease.orgId === actor.orgId`. If missing or mismatched, return 404.

## 3. Concurrent webhooks can create two payments — Critical

**Lines:** `gateway/route.ts` 380–398

**What goes wrong:** The paid short-circuit reads the bill outside a lock, then the transaction updates the bill and inserts a payment. Two simultaneous `paid=true` deliveries can both observe `status !== 'paid'`, both insert payments, and both allocate. Unique constraints are not relied on here, and `receivedAt: new Date()` also ignores `paid_at`.

**Concrete scenario:** Gateway retries the same callback 5 ms apart. The lease is charged twice.

**Fix:** `SELECT … FOR UPDATE` the bill row inside the transaction; if already paid, return 200 with no insert. Enforce `UNIQUE (gateway_bill_id)` on payments and treat unique violations as idempotent success. Set `receivedAt` from parsed `paid_at`.

## 4. Invalid signature logging leaks the callback and expected MAC — High

**Lines:** `gateway/route.ts` 374–376

**What goes wrong:** On a bad signature the handler logs `{ fields, expected }`. That dumps the full form body (including any future secret-bearing fields) and the HMAC the server computed. The brief forbids logging the secret key or whole callback payloads; logging `expected` also helps an attacker confirm forgeries.

**Fix:** Return 401 with no payload logging. At most log a static `"invalid gateway signature"` string.

## 5. `paid=false` is ignored and never marks the bill failed — High

**Lines:** `gateway/route.ts` 378

**What goes wrong:** Any non-`true` `paid` value returns 200 immediately. A legitimate `paid=false` / `failed` callback leaves a pending bill forever, so tenants keep seeing it as payable and later `paid=true` still works—but failed delivery semantics from the brief are missing (pending → failed, failed replay no-op, paid never demoted).

**Fix:** Branch on `paid === 'false'`: if pending, set `failed`; if already failed or paid, return 200 without change.

## 6. No amount check on `paid_amount` — High

**Lines:** `gateway/route.ts` 384–395

**What goes wrong:** The payment is created with `BigInt(fields.paid_amount)` without comparing it to `bill.amountSen`. A forged or buggy callback with a valid signature could underpay or overpay relative to the bill (422 is required when they differ).

**Fix:** If `paid_amount` is not exactly the bill amount, return 422 and change nothing.

## 7. Late-fee “today” and cutoff use a fake UTC+8 shift — High

**Lines:** `late-fees/route.ts` 329–330, 334

**What goes wrong:** `Date.now() + 8 * 3600 * 1000` then `toISOString().slice(0, 10)` is not Asia/Kuala_Lumpur civil time (DST-free MYT is UTC+8, but combining that with `Date.parse(todayMyt)` treats the date as UTC midnight). Comparing `invoice.dueDate` (a Date/timestamptz) to `cutoff` mixes calendar dates and instants. Invoices near midnight boundaries are skipped or charged incorrectly.

**Fix:** Compute today’s Malaysia civil date with `Intl` / `Asia/Kuala_Lumpur`, subtract grace days on the calendar date, and compare date-only values.

## 8. Floating-point money and “almost paid” threshold — High

**Lines:** `late-fees/route.ts` 335–337

**What goes wrong:** Allocations are summed as bigint then converted with `Number`, divided, and compared to `0.995`. Money must stay integer sen. An invoice with 1 sen unpaid of a large total can be treated as paid and skip the fee; conversely rounding can fabricate fees. `Math.round` on `Number(invoice.amountSen - paid)` also risks precision loss on large bigint values.

**Fix:** Keep all math in integer sen: skip when `unpaid === 0n`; fee = `(unpaid * 2n + 50n) / 100n` or the product’s specified rounding, never float ratios.

## 9. Race in `nextReference` and invalid `kind` / schema assumptions — Medium

**Lines:** `late-fees/route.ts` 339–357

**What goes wrong:** Each fee awaits `nextReference` before `Promise.all` creates rows, but two concurrent requests can read the same last reference and insert duplicates. The code also inserts `kind: 'late_fee'` and a `reference` field that are not in the required schema (`deposit | rent` only), so this either fails at runtime or invents unpaid schema the brief does not define.

**Fix:** Do not invent `late_fee` invoices unless the schema is extended. If references are required, allocate them under a per-org lock or use a sequence inside the same transaction.

## 10. Collections report uses UTC month truncation and skips empty months — Medium

**Lines:** `dashboard/actions.ts` 407–415

**What goes wrong:** `date_trunc('month', received_at)` uses the session/UTC timeline, not Malaysia local time. A payment at `2026-03-01 00:30 +0800` (`2026-02-28T16:30:00Z`) lands in February UTC and disappears from March MYT collections. The query also returns only months with rows, while the brief requires every month in the range, including zeros (Northwind Feb 2026 = 0).

**Fix:** Group by `to_char((received_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM')` and fill missing months in application code. Do not take `orgId` from the caller without verifying membership.

## Suspicious but acceptable (not scored as defects)

- Using `prisma` as the database owner bypasses RLS; that matches the brief, provided every handler still enforces org/role checks in application code (this PR does not).
- Assuming `allocate(tx, paymentId)` is correct per the prompt; the surrounding transaction still needs the locking/idempotency fixes above.
