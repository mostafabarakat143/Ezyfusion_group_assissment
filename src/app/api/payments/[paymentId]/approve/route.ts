import { requireActor } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { approvePayment } from "@/lib/payments";

export async function POST(
  request: Request,
  context: { params: Promise<{ paymentId: string }> },
) {
  try {
    const actor = await requireActor(request);
    const { paymentId } = await context.params;
    const result = await approvePayment(actor, paymentId);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
