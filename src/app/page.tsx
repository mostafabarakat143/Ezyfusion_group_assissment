import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex flex-1 items-center justify-center px-6 py-16 text-muted-foreground">
          Loading…
        </main>
      }
    >
      <HomeRedirect />
    </Suspense>
  );
}

async function HomeRedirect(): Promise<never> {
  await connection();
  let actor;
  try {
    actor = await requirePageActor();
  } catch {
    redirect("/login");
  }
  redirect(actor.kind === "tenant" ? "/portal" : "/dashboard");
}
