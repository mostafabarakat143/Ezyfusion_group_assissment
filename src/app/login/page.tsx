import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16 text-muted-foreground">
          Loading…
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

async function LoginContent() {
  await connection();
  let actor;
  try {
    actor = await requirePageActor();
  } catch {
    actor = null;
  }
  if (actor) {
    redirect(actor.kind === "tenant" ? "/portal" : "/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">EzyFusion</h1>
        <p className="text-muted-foreground">
          Sign in to manage leases, invoices, and rent payments.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
