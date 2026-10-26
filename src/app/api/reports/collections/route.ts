import { requireActor } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { getCollectionsReport } from "@/lib/payments";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const result = await getCollectionsReport(actor, from, to);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
