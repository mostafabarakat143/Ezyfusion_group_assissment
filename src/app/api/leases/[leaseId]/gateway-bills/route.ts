import { requireActor } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { createGatewayBill } from "@/lib/gateway";

export async function POST(
  request: Request,
  context: { params: Promise<{ leaseId: string }> },
) {
  try {
    const actor = await requireActor(request);
    const { leaseId } = await context.params;
    const result = await createGatewayBill(actor, leaseId);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
