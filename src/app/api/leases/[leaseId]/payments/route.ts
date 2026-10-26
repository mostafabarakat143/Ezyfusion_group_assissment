import { requireActor } from "@/lib/auth";
import { jsonError, readJsonBody } from "@/lib/errors";
import {
  recordPayment,
  type RecordPaymentInput,
} from "@/lib/payments";

export async function POST(
  request: Request,
  context: { params: Promise<{ leaseId: string }> },
) {
  try {
    const actor = await requireActor(request);
    const { leaseId } = await context.params;
    const body = await readJsonBody<Partial<RecordPaymentInput>>(request);
    const result = await recordPayment(actor, leaseId, {
      amountSen: body.amountSen as number,
      method: body.method as RecordPaymentInput["method"],
      receivedAt: body.receivedAt as string,
      slipPath: body.slipPath,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
