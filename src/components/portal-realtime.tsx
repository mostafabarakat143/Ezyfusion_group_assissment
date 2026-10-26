"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * Refresh the tenant portal when payments/invoices/allocations change for
 * the tenant's leases. Subscribes with the user JWT; RLS still applies.
 */
export function PortalRealtime({ leaseIds }: { leaseIds: string[] }) {
  const router = useRouter();
  const leaseKey = [...leaseIds].sort().join(",");

  useEffect(() => {
    if (!leaseKey) return;

    const ids = leaseKey.split(",");
    const supabase = createBrowserSupabaseClient();
    const filter = `lease_id=in.(${ids.join(",")})`;
    const channel = supabase
      .channel(`portal-leases-${leaseKey.slice(0, 64)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payments",
          filter,
        },
        () => {
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "invoices",
          filter,
        },
        () => {
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_allocations",
        },
        () => {
          // Allocations are scoped by RLS to the tenant's leases.
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [leaseKey, router]);

  return null;
}
