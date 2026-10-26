"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PaymentActions({
  paymentId,
  status,
}: {
  paymentId: string;
  status: string;
}) {
  const [open, setOpen] = useState<"approve" | "reject" | "void" | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function runAction() {
    setLoading(true);
    try {
      const path =
        open === "approve"
          ? `/api/payments/${paymentId}/approve`
          : open === "reject"
            ? `/api/payments/${paymentId}/reject`
            : `/api/payments/${paymentId}/void`;
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body:
          open === "approve"
            ? undefined
            : JSON.stringify({ reason }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Action failed");
      }
      toast.success(
        open === "approve"
          ? "Payment approved."
          : open === "reject"
            ? "Payment rejected."
            : "Payment voided.",
      );
      setOpen(null);
      setReason("");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending_verification" ? (
        <>
          <Button size="sm" onClick={() => setOpen("approve")}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen("reject")}
          >
            Reject
          </Button>
        </>
      ) : null}
      {status === "approved" ? (
        <Button size="sm" variant="destructive" onClick={() => setOpen("void")}>
          Void
        </Button>
      ) : null}

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open === "approve"
                ? "Approve payment"
                : open === "reject"
                  ? "Reject payment"
                  : "Void payment"}
            </DialogTitle>
            <DialogDescription>
              {open === "approve"
                ? "This allocates the payment to unpaid invoices."
                : "Provide a reason of at least 5 characters."}
            </DialogDescription>
          </DialogHeader>
          {open === "reject" || open === "void" ? (
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={5}
                required
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(null)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={runAction}
              disabled={
                loading ||
                ((open === "reject" || open === "void") &&
                  reason.trim().length < 5)
              }
            >
              {loading ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
