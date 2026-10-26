"use client";

import { useState } from "react";
import { toast } from "sonner";
import { parseRinggitToSen } from "@/lib/billing";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const MAX_SLIP_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

export function PaymentForm({
  leaseId,
  orgId,
  isManager,
}: {
  leaseId: string;
  orgId: string;
  isManager: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank_transfer">("cash");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    let slipPath: string | undefined;
    const supabase = createBrowserSupabaseClient();

    try {
      let amountSen: number;
      try {
        amountSen = parseRinggitToSen(amount);
      } catch {
        throw new Error(
          'Enter a valid amount such as 1500, 1,500.50, or 7.',
        );
      }
      if (amountSen <= 0) {
        throw new Error("Amount must be greater than zero.");
      }
      if (!date || !time) {
        throw new Error("Choose the received date and time in Malaysia time.");
      }

      const receivedAt = `${date}T${time.length === 5 ? `${time}:00` : time}+08:00`;

      if (method === "bank_transfer") {
        if (!file) {
          throw new Error("Attach a JPEG, PNG, or PDF slip for bank transfers.");
        }
        if (!ALLOWED_TYPES.has(file.type)) {
          throw new Error("Slip must be a JPEG, PNG, or PDF file.");
        }
        if (file.size > MAX_SLIP_BYTES) {
          throw new Error("Slip must be 5 MB or smaller.");
        }
        slipPath = `${orgId}/${leaseId}-${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const upload = await supabase.storage
          .from("payment-slips")
          .upload(slipPath, file, {
            contentType: file.type,
            upsert: false,
          });
        if (upload.error) {
          throw new Error(upload.error.message);
        }
      }

      const response = await fetch(`/api/leases/${leaseId}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountSen,
          method,
          receivedAt,
          slipPath,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        status?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not record payment");
      }

      toast.success(
        isManager
          ? "Payment recorded and approved."
          : "Payment recorded. Waiting for manager approval.",
      );
      setAmount("");
      setFile(null);
      window.location.reload();
    } catch (err) {
      if (slipPath) {
        await supabase.storage.from("payment-slips").remove([slipPath]);
      }
      const message =
        err instanceof Error ? err.message : "Could not record payment";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="text-lg font-medium">Record payment</h2>
        <p className="text-sm text-muted-foreground">
          Amounts are Malaysian ringgit. Date and time are Asia/Kuala_Lumpur.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount (RM)</Label>
          <Input
            id="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="1,500.00"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="method">Method</Label>
          <select
            id="method"
            className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as "cash" | "bank_transfer")
            }
          >
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Received date (MYT)</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="time">Received time (MYT)</Label>
          <Input
            id="time"
            type="time"
            step={1}
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />
        </div>
      </div>
      {method === "bank_transfer" ? (
        <div className="space-y-2">
          <Label htmlFor="slip">Bank slip (JPEG, PNG, or PDF, max 5 MB)</Label>
          <Input
            id="slip"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
        </div>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Saving…" : "Record payment"}
      </Button>
    </form>
  );
}
