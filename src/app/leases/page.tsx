import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth";
import { listOrgLeases } from "@/lib/dashboard";
import { formatDisplayDate } from "@/lib/dates";
import { formatRinggit } from "@/lib/money";
import { AppShell } from "@/components/app-shell";
import { LeasesSearch } from "@/components/leases-search";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-6 py-8 text-muted-foreground">
          Loading leases…
        </main>
      }
    >
      <LeasesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LeasesContent({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
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

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const pageRaw = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const result = await listOrgLeases(actor, { q, page, pageSize: 10 });
  const isManager = actor.role === "manager";

  function hrefFor(nextPage: number) {
    const sp = new URLSearchParams();
    if (result.q) sp.set("q", result.q);
    if (nextPage > 1) sp.set("page", String(nextPage));
    const query = sp.toString();
    return query ? `/leases?${query}` : "/leases";
  }

  return (
    <AppShell actor={actor}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 pr-4">
            <h1 className="text-2xl font-semibold tracking-tight">Leases</h1>
            <p className="mt-1 text-muted-foreground">
              Search and page through leases in your organization.
            </p>
          </div>
          {isManager ? (
            <Link
              href="/leases/new"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-10 shrink-0 self-end px-8 sm:mt-1 sm:self-start",
              )}
              style={{ paddingLeft: "2rem", paddingRight: "2rem" }}
            >
              Create lease
            </Link>
          ) : null}
        </div>

        <LeasesSearch initialQ={result.q} />

        {result.leases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {result.q
              ? `No leases match “${result.q}”.`
              : "No leases yet."}
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.leases.map((lease) => (
                  <TableRow key={lease.id}>
                    <TableCell>
                      <Link
                        href={`/leases/${lease.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {lease.unitName}
                      </Link>
                    </TableCell>
                    <TableCell>{lease.tenantName}</TableCell>
                    <TableCell>
                      {formatDisplayDate(lease.startDate)} –{" "}
                      {formatDisplayDate(lease.endDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatRinggit(lease.monthlyRentSen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>
            {result.total === 0
              ? "0 results"
              : `Page ${result.page} of ${result.totalPages} · ${result.total} lease${result.total === 1 ? "" : "s"}`}
          </p>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Link
                href={hrefFor(result.page - 1)}
                className="underline-offset-4 hover:underline"
              >
                Previous
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link
                href={hrefFor(result.page + 1)}
                className="underline-offset-4 hover:underline"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
