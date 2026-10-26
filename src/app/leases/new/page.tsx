import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth";
import { listOrgLeaseOptions } from "@/lib/org-options";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { CreateLeaseForm } from "@/components/create-lease-form";

export default function NewLeasePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-6 py-8 text-muted-foreground">
          Loading create lease…
        </main>
      }
    >
      <NewLeaseContent />
    </Suspense>
  );
}

async function NewLeaseContent() {
  await connection();
  let actor;
  try {
    actor = await requirePageActor();
  } catch {
    redirect("/login");
  }
  if (actor.kind !== "membership" || actor.role !== "manager") {
    redirect("/leases");
  }

  const options = await listOrgLeaseOptions(actor);

  return (
    <AppShell actor={actor}>
      <div className="w-full space-y-8">
        <div className="space-y-3">
          <BackButton href="/leases" />
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              Create lease
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Choose a unit and tenant, set the rent period, and confirm the
              invoice schedule before saving.
            </p>
          </div>
        </div>
        <CreateLeaseForm units={options.units} tenants={options.tenants} />
      </div>
    </AppShell>
  );
}
