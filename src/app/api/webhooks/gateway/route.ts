import { handleGatewayWebhook } from "@/lib/gateway";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const fields: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        fields[key] = value;
      }
    }

    const result = await handleGatewayWebhook(fields);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    // Never log secrets or full webhook payloads.
    console.error("Gateway webhook failed");
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
