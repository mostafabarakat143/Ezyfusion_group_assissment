import Link from "next/link";
import type { Actor } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

export function AppShell({
  actor,
  children,
}: {
  actor: Actor;
  children: React.ReactNode;
}) {
  const roleLabel =
    actor.kind === "tenant" ? "tenant" : actor.role;

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4 sm:gap-6">
            <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
              EzyFusion
            </Link>
            <nav className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
              {actor.kind === "membership" ? (
                <>
                  <Link href="/dashboard" className="hover:underline">
                    Dashboard
                  </Link>
                  <Link href="/leases" className="hover:underline">
                    Leases
                  </Link>
                </>
              ) : (
                <Link href="/portal" className="hover:underline">
                  My leases
                </Link>
              )}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
            <span className="capitalize">{roleLabel}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}
