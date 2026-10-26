import { requireActor } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { getLeaseDetail } from "@/lib/leases";

export async function GET(
  request: Request,
  context: { params: Promise<{ leaseId: string }> },
) {
  try {
    const actor = await requireActor(request);
    const { leaseId } = await context.params;
    const detail = await getLeaseDetail(actor, leaseId);
    // Keep the HTTP contract exact; allocations are UI-only extras.
    return Response.json({
      lease: detail.lease,
      invoices: detail.invoices,
      payments: detail.payments.map(
        ({ id, amountSen, unappliedSen, method, status, receivedAt }) => ({
          id,
          amountSen,
          unappliedSen,
          method,
          status,
          receivedAt,
        }),
      ),
    });
  } catch (error) {
    return jsonError(error);
  }
}
