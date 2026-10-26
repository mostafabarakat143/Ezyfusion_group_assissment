import { requireActor } from "@/lib/auth";
import { jsonError, readJsonBody } from "@/lib/errors";
import { rejectPayment } from "@/lib/payments";

export async function POST(
  request: Request,
  context: { params: Promise<{ paymentId: string }> },
) {
  try {
    const actor = await requireActor(request);
    const { paymentId } = await context.params;
    const body = await readJsonBody<{ reason?: string }>(request);
    const result = await rejectPayment(actor, paymentId, body.reason ?? "");
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
