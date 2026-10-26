import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth";
import { amountDueNow, getTenantPortal } from "@/lib/dashboard";
import { formatDisplayDate } from "@/lib/dates";
import { getLeaseDetail } from "@/lib/leases";
import { formatRinggit } from "@/lib/money";
import { AppShell } from "@/components/app-shell";
import { PayNowButton } from "@/components/pay-now-button";
import { PhoneEditor } from "@/components/phone-editor";
import { PortalRealtime } from "@/components/portal-realtime";
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

export default function PortalPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-6 py-8 text-muted-foreground">
          Loading portal…
        </main>
      }
    >
      <PortalContent />
    </Suspense>
  );
}

async function PortalContent() {
  await connection();
  let actor;
  try {
    actor = await requirePageActor();
  } catch {
    redirect("/login");
  }
  if (actor.kind !== "tenant") {
    redirect("/dashboard");
  }

  const portal = await getTenantPortal(actor);
  const leaseSummaries = await Promise.all(
    portal.leases.map(async (lease) => {
      const detail = await getLeaseDetail(actor, lease.id);
      return {
        ...lease,
        dueNow: amountDueNow(detail.invoices),
        invoices: detail.invoices,
        payments: detail.payments,
      };
    }),
  );

  return (
    <AppShell actor={actor}>
      <PortalRealtime leaseIds={portal.leases.map((lease) => lease.id)} />
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hello, {portal.tenant.fullName}
          </h1>
          <p className="text-muted-foreground">
            Your leases, invoices, and payments in Malaysia time. Updates when
            payments settle.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{portal.tenant.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <PhoneEditor
              tenantId={portal.tenant.id}
              initialPhone={portal.tenant.phone}
            />
          </CardContent>
        </Card>

        {leaseSummaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leases assigned.</p>
        ) : (
          leaseSummaries.map((lease) => (
            <Card key={lease.id}>
              <CardHeader>
                <CardTitle>
                  <Link
                    href={`/leases/${lease.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    Unit {lease.unitName}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {formatDisplayDate(lease.startDate)} –{" "}
                  {formatDisplayDate(lease.endDate)} · due now{" "}
                  {formatRinggit(lease.dueNow)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <h3 className="font-medium">Invoices</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lease.invoices.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell>
                            {formatDisplayDate(invoice.dueDate)}
                          </TableCell>
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
                <div className="space-y-2">
                  <h3 className="font-medium">Payments</h3>
                  {lease.payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No payments yet.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lease.payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className="capitalize">
                              {payment.method.replaceAll("_", " ")}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatRinggit(payment.amountSen)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={payment.status} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="font-medium">Amount due now</h3>
                  <p className="text-2xl font-semibold">
                    {formatRinggit(lease.dueNow)}
                  </p>
                  {lease.dueNow > 0 ? (
                    <PayNowButton leaseId={lease.id} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nothing is due right now.
                    </p>
                  )}
                </div>
                <Link
                  href={`/leases/${lease.id}`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  Open full lease details →
                </Link>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
