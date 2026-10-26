import { requireActor } from "@/lib/auth";
import { jsonError, readJsonBody } from "@/lib/errors";
import { createLease, type CreateLeaseInput } from "@/lib/leases";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request);
    const body = await readJsonBody<Partial<CreateLeaseInput>>(request);
    const result = await createLease(actor, {
      unitId: body.unitId as string,
      tenantId: body.tenantId as string,
      startDate: body.startDate as string,
      endDate: body.endDate as string,
      monthlyRentSen: body.monthlyRentSen as number,
      depositSen: body.depositSen as number,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
