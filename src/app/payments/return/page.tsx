import { Suspense } from "react";
import { connection } from "next/server";
import { getGatewayBillStatus } from "@/lib/gateway";
import { formatRinggit } from "@/lib/money";
import { BackButton } from "@/components/back-button";
import { StatusBadge } from "@/components/status-badge";

/**
 * Gateway return page. Reads bill status only — never settles payments.
 * Settlement happens exclusively in POST /api/webhooks/gateway.
 */
export default function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ bill_id?: string; paid?: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Payment return</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page only shows the bill status from the database. It never records
        or changes a payment.
      </p>
      <Suspense
        fallback={
          <p className="mt-6 text-muted-foreground">Loading bill status…</p>
        }
      >
        <PaymentReturnStatus searchParams={searchParams} />
      </Suspense>
      <div className="mt-8">
        <BackButton href="/portal" />
      </div>
    </main>
  );
}

async function PaymentReturnStatus({
  searchParams,
}: {
  searchParams: Promise<{ bill_id?: string; paid?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const billId = params.bill_id;

  if (!billId) {
    return <p className="mt-6 text-muted-foreground">Missing bill id.</p>;
  }

  let bill;
  try {
    bill = await getGatewayBillStatus(billId);
  } catch {
    return <p className="mt-6 text-muted-foreground">Bill not found.</p>;
  }

  return (
    <div className="mt-6 space-y-2 rounded-xl border p-4">
      <p>
        <span className="text-muted-foreground">Bill ID</span>
        <br />
        <code className="text-sm">{bill.billId}</code>
      </p>
      <p>
        <span className="text-muted-foreground">Amount</span>
        <br />
        {formatRinggit(bill.amountSen)}
      </p>
      <p className="flex items-center gap-2">
        <span className="text-muted-foreground">Status</span>
        <StatusBadge status={bill.status} />
      </p>
    </div>
  );
}
