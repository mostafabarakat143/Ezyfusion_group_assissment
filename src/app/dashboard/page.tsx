import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth";
import { getStaffDashboard } from "@/lib/dashboard";
import { formatRinggit } from "@/lib/money";
import { AppShell } from "@/components/app-shell";
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

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-6 py-8 text-muted-foreground">
          Loading dashboard…
        </main>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  await connection();
  let actor;
  try {
    actor = await requirePageActor();
  } catch {
    redirect("/login");
  }
  if (actor.kind !== "membership") {
    redirect("/portal");
  }

  const dashboard = await getStaffDashboard(actor);

  return (
    <AppShell actor={actor}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overdue invoices and collections for the last six Malaysia months.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Overdue invoices</CardTitle>
              <CardDescription>Unpaid after the due date in Malaysia time</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-semibold">{dashboard.overdueCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Collections window</CardTitle>
              <CardDescription>
                {dashboard.fromMonth} to {dashboard.toMonth}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-semibold">
                {formatRinggit(
                  dashboard.collections.reduce(
                    (sum, row) => sum + row.collectedSen,
                    0,
                  ),
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Collections by month</CardTitle>
            <CardDescription>Approved payments by received_at in Asia/Kuala_Lumpur</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.collections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No collections yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.collections.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell>{row.month}</TableCell>
                      <TableCell className="text-right">
                        {formatRinggit(row.collectedSen)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
