import { requireActor, requireStaffOrManager } from "@/lib/auth";
import { jsonError, AppError, requireUuid } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Staff/managers read slips only through this route. The handler mints a
 * short-lived signed URL with the service role; Storage has no SELECT policy
 * for authenticated JWTs (TASK §6).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ paymentId: string }> },
) {
  try {
    const actor = await requireActor(request);
    const { paymentId } = await context.params;
    requireUuid(paymentId);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { lease: { select: { tenantId: true } } },
    });
    if (!payment) {
      throw new AppError(404, "Not found");
    }
    if (actor.kind === "membership") {
      if (actor.orgId !== payment.orgId) {
        throw new AppError(404, "Not found");
      }
    } else if (actor.tenantId !== payment.lease.tenantId) {
      throw new AppError(404, "Not found");
    } else {
      throw new AppError(403, "Forbidden");
    }
    requireStaffOrManager(actor);

    if (!payment.slipPath || payment.method !== "bank_transfer") {
      throw new AppError(404, "Not found");
    }

    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("payment-slips")
      .createSignedUrl(payment.slipPath, 60);
    if (error || !data?.signedUrl) {
      throw new AppError(404, "Not found");
    }

    return Response.redirect(data.signedUrl, 302);
  } catch (error) {
    return jsonError(error);
  }
}
