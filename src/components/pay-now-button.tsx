"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatRinggit } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PayNowButton({ leaseId }: { leaseId: string }) {
  const [loading, setLoading] = useState(false);
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(
    null,
  );

  async function onClick() {
    setLoading(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/gateway-bills`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        error?: string;
        billId?: string;
        amountSen?: number;
      };
      if (!response.ok || !body.billId || body.amountSen === undefined) {
        throw new Error(body.error ?? "Could not create bill");
      }
      setBill({ billId: body.billId, amountSen: body.amountSen });
      toast.success("Gateway bill created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create bill");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={onClick} disabled={loading}>
        {loading ? "Creating bill…" : "Pay now"}
      </Button>
      {bill ? (
        <Alert>
          <AlertTitle>Gateway bill ready</AlertTitle>
          <AlertDescription>
            Bill ID <code>{bill.billId}</code> for {formatRinggit(bill.amountSen)}.
            In production you would be redirected to the gateway. Use{" "}
            <code>node gateway-sim.mjs {bill.billId} {bill.amountSen}</code> to
            simulate payment, then open{" "}
            <a
              className="underline"
              href={`/payments/return?bill_id=${encodeURIComponent(bill.billId)}&paid=true`}
            >
              the return page
            </a>
            .
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
