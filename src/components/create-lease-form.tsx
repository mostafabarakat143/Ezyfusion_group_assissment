"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  generateSchedule,
  parseRinggitToSen,
  type ScheduledInvoice,
} from "@/lib/billing";
import { formatDisplayDate } from "@/lib/dates";
import { formatRinggit } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const triggerClassName = "h-11 w-full min-w-0 rounded-lg px-3.5";

const emptyPreview = {
  schedule: [] as ScheduledInvoice[],
  error: null as string | null,
  monthlyRentSen: null as number | null,
  depositSen: null as number | null,
};

export function CreateLeaseForm({
  units,
  tenants,
}: {
  units: { id: string; name: string; occupied: boolean }[];
  tenants: { id: string; fullName: string; email: string }[];
}) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [startDate, setStartDate] = useState("2026-01-31");
  const [endDate, setEndDate] = useState("2026-07-15");
  const [rentInput, setRentInput] = useState("1,500.00");
  const [depositInput, setDepositInput] = useState("3,000.00");
  const [loading, setLoading] = useState(false);

  const unitItems = useMemo(
    () =>
      Object.fromEntries(
        units.map((unit) => [
          unit.id,
          `${unit.name}${unit.occupied ? " · occupied" : " · vacant"}`,
        ]),
      ),
    [units],
  );

  const tenantItems = useMemo(
    () =>
      Object.fromEntries(
        tenants.map((tenant) => [tenant.id, tenant.fullName]),
      ),
    [tenants],
  );

  const preview = useMemo(() => {
    if (!startDate || !endDate || !rentInput.trim()) {
      return emptyPreview;
    }
    try {
      const depositRaw = depositInput.trim() === "" ? "0" : depositInput;
      const monthlyRentSen = parseRinggitToSen(rentInput);
      const depositSen = parseRinggitToSen(depositRaw);
      if (depositSen < 0) {
        return {
          schedule: [] as ScheduledInvoice[],
          error: "Deposit cannot be negative.",
          monthlyRentSen: null as number | null,
          depositSen: null as number | null,
        };
      }
      const schedule = generateSchedule({
        startDate,
        endDate,
        monthlyRentSen,
        depositSen,
      });
      return {
        schedule,
        error: null as string | null,
        monthlyRentSen,
        depositSen,
      };
    } catch (err) {
      return {
        schedule: [] as ScheduledInvoice[],
        error: err instanceof Error ? err.message : "Invalid schedule inputs",
        monthlyRentSen: null as number | null,
        depositSen: null as number | null,
      };
    }
  }, [startDate, endDate, rentInput, depositInput]);

  const canSubmit =
    Boolean(unitId && tenantId) &&
    !preview.error &&
    preview.schedule.length > 0 &&
    preview.monthlyRentSen !== null &&
    preview.depositSen !== null;

  function resetForm() {
    setUnitId(units[0]?.id ?? "");
    setTenantId(tenants[0]?.id ?? "");
    setStartDate("2026-01-31");
    setEndDate("2026-07-15");
    setRentInput("1,500.00");
    setDepositInput("3,000.00");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (
      !canSubmit ||
      preview.monthlyRentSen === null ||
      preview.depositSen === null
    ) {
      toast.error(preview.error ?? "Fix the schedule inputs before creating.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/leases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unitId,
          tenantId,
          startDate,
          endDate,
          monthlyRentSen: preview.monthlyRentSen,
          depositSen: preview.depositSen,
        }),
      });
      const body = (await response.json()) as { error?: string; id?: string };
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error(
            body.error ??
              "This lease overlaps another lease on the same unit.",
          );
        }
        if (response.status === 400) {
          throw new Error(body.error ?? "Invalid lease input.");
        }
        if (response.status === 403) {
          throw new Error("Only managers can create leases.");
        }
        throw new Error(body.error ?? "Could not create lease");
      }
      if (!body.id) {
        throw new Error("Lease was created but no id was returned.");
      }

      const invoiceCount = preview.schedule.length;
      const leaseId = body.id;
      resetForm();
      toast.success(
        `Lease created with ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}.`,
        {
          action: {
            label: "View lease",
            onClick: () => {
              window.location.assign(`/leases/${leaseId}`);
            },
          },
        },
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create lease",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <form
        onSubmit={onSubmit}
        className="space-y-6 rounded-xl border border-border bg-card p-6"
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">New lease</h2>
          <p className="text-sm text-muted-foreground">
            Enter rent in ringgit. Dates are Malaysia calendar days. The preview
            is exactly what will be saved.
          </p>
        </div>

        {units.length === 0 || tenants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a unit and tenant in this organization before creating a lease.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="unitId">Unit</Label>
            <Select
              items={unitItems}
              value={unitId || null}
              onValueChange={(value) => setUnitId(value ?? "")}
            >
              <SelectTrigger id="unitId" className={triggerClassName}>
                <SelectValue placeholder="Select a unit" />
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className="rounded-lg p-1"
              >
                {units.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unitItems[unit.id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenantId">Tenant</Label>
            <Select
              items={tenantItems}
              value={tenantId || null}
              onValueChange={(value) => setTenantId(value ?? "")}
            >
              <SelectTrigger id="tenantId" className={triggerClassName}>
                <SelectValue placeholder="Select a tenant" />
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className="rounded-lg p-1"
              >
                {tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="startDate">Start date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              placeholder="YYYY-MM-DD"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="endDate">End date</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              placeholder="YYYY-MM-DD"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rent">Monthly rent (RM)</Label>
            <Input
              id="rent"
              value={rentInput}
              onChange={(event) => setRentInput(event.target.value)}
              placeholder="e.g. 1,500.00"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="deposit">Deposit (RM)</Label>
            <Input
              id="deposit"
              value={depositInput}
              onChange={(event) => setDepositInput(event.target.value)}
              placeholder="e.g. 0 or 3,000.00"
              required
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            className="h-11 min-w-44 px-8"
            disabled={
              loading ||
              !canSubmit ||
              units.length === 0 ||
              tenants.length === 0
            }
          >
            {loading ? "Creating…" : "Create lease"}
          </Button>
        </div>
      </form>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Schedule preview
          </h2>
          <p className="text-sm text-muted-foreground">
            Updates as you type. These invoices are created with the lease.
          </p>
          {!preview.error && preview.schedule.length > 0 ? (
            <p className="pt-1 text-sm font-medium">
              {preview.schedule.length}{" "}
              {preview.schedule.length === 1 ? "invoice" : "invoices"} · total{" "}
              {formatRinggit(
                preview.schedule.reduce((sum, row) => sum + row.amountSen, 0),
              )}
            </p>
          ) : null}
        </div>

        {preview.error ? (
          <p className="rounded-lg bg-muted px-4 py-4 text-sm text-muted-foreground">
            Enter valid dates and amounts to preview the schedule.
          </p>
        ) : preview.schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Kind</TableHead>
                  <TableHead className="px-4">Period</TableHead>
                  <TableHead className="px-4">Due</TableHead>
                  <TableHead className="px-4 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.schedule.map((row, index) => (
                  <TableRow
                    key={`${row.kind}-${row.periodIndex ?? "d"}-${index}`}
                  >
                    <TableCell className="px-4 capitalize whitespace-nowrap">
                      {row.kind}
                      {row.periodIndex !== null ? ` #${row.periodIndex}` : ""}
                    </TableCell>
                    <TableCell className="px-4 whitespace-nowrap text-muted-foreground">
                      {row.periodStart && row.periodEnd
                        ? `${formatDisplayDate(row.periodStart)} – ${formatDisplayDate(row.periodEnd)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="px-4 whitespace-nowrap">
                      {formatDisplayDate(row.dueDate)}
                    </TableCell>
                    <TableCell className="px-4 text-right font-medium whitespace-nowrap">
                      {formatRinggit(row.amountSen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
