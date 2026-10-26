import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth";
import { amountDueNow } from "@/lib/dashboard";
import { formatDisplayDate, formatMalaysiaDateTime } from "@/lib/dates";
import { getLeaseDetail } from "@/lib/leases";
import { formatRinggit } from "@/lib/money";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { PaymentActions } from "@/components/payment-actions";
import { PaymentForm } from "@/components/payment-form";
import { PayNowButton } from "@/components/pay-now-button";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function LeaseDetailPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-6 py-8 text-muted-foreground">
          Loading lease…
        </main>
      }
    >
      <LeaseDetailContent params={params} />
    </Suspense>
  );
}

async function LeaseDetailContent({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  await connection();
  let actor;
  try {
    actor = await requirePageActor();
  } catch {
    redirect("/login");
  }

  const { leaseId } = await params;
  let detail;
  try {
    detail = await getLeaseDetail(actor, leaseId);
  } catch {
    redirect(actor.kind === "tenant" ? "/portal" : "/leases");
  }

  const dueNow = amountDueNow(detail.invoices);
  const isManager = actor.kind === "membership" && actor.role === "manager";
  const canRecord = actor.kind === "membership";

  return (
    <AppShell actor={actor}>
      <div className="space-y-8">
        <div className="space-y-3">
          <BackButton href={actor.kind === "tenant" ? "/portal" : "/leases"} />
          <h1 className="text-2xl font-semibold tracking-tight">Lease</h1>
          <p className="text-muted-foreground">
            {formatDisplayDate(detail.lease.startDate)} to{" "}
            {formatDisplayDate(detail.lease.endDate)} · rent{" "}
            {formatRinggit(detail.lease.monthlyRentSen)}
            {detail.lease.depositSen > 0
              ? ` · deposit ${formatRinggit(detail.lease.depositSen)}`
              : ""}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Amount due now</CardTitle>
            <CardDescription>
              Unpaid invoices due on or before today’s Malaysia date
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-3xl font-semibold">{formatRinggit(dueNow)}</p>
            {actor.kind === "tenant" ? (
              dueNow > 0 ? (
                <PayNowButton leaseId={leaseId} />
              ) : (
                <p className="text-sm text-muted-foreground">Nothing is due right now.</p>
              )
            ) : null}
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Invoices</h2>
          {detail.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices.</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="capitalize">
                        {invoice.kind}
                        {invoice.periodIndex !== null
                          ? ` #${invoice.periodIndex}`
                          : ""}
                      </TableCell>
                      <TableCell>
                        {invoice.periodStart && invoice.periodEnd
                          ? `${formatDisplayDate(invoice.periodStart)} – ${formatDisplayDate(invoice.periodEnd)}`
                          : "—"}
                      </TableCell>
                      <TableCell>{formatDisplayDate(invoice.dueDate)}</TableCell>
                      <TableCell className="text-right">
                        {formatRinggit(invoice.amountSen)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRinggit(invoice.paidSen)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={invoice.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Payments</h2>
          {detail.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Unapplied</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {formatMalaysiaDateTime(payment.receivedAt)}
                      </TableCell>
                      <TableCell className="capitalize">
                        {payment.method.replaceAll("_", " ")}
                        {payment.method === "bank_transfer" &&
                        actor.kind === "membership" ? (
                          <>
                            {" · "}
                            <a
                              className="underline"
                              href={`/api/payments/${payment.id}/slip`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Slip
                            </a>
                          </>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRinggit(payment.amountSen)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRinggit(payment.unappliedSen)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={payment.status} />
                      </TableCell>
                      <TableCell>
                        {isManager ? (
                          <PaymentActions
                            paymentId={payment.id}
                            status={payment.status}
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Payment allocations</h2>
          {detail.payments.every((payment) => payment.allocations.length === 0) ? (
            <p className="text-sm text-muted-foreground">
              No allocations yet. Approved payments allocate to unpaid invoices
              in due-date order.
            </p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="text-right">Allocated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.payments.flatMap((payment) =>
                    payment.allocations.map((allocation) => (
                      <TableRow key={allocation.id}>
                        <TableCell className="font-mono text-xs">
                          {payment.id.slice(0, 8)}…
                        </TableCell>
                        <TableCell>{allocation.invoiceLabel}</TableCell>
                        <TableCell className="text-right">
                          {formatRinggit(allocation.amountSen)}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {canRecord ? (
          <PaymentForm
            leaseId={leaseId}
            orgId={actor.orgId}
            isManager={isManager}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
