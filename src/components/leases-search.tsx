"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEBOUNCE_MS = 300;

export function LeasesSearch({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  useEffect(() => {
    setQ(initialQ);
  }, [initialQ]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const trimmed = q.trim();
      const paramsSnapshot = searchParamsRef.current;
      const current = (paramsSnapshot.get("q") ?? "").trim();
      if (trimmed === current) return;

      const params = new URLSearchParams(paramsSnapshot.toString());
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      params.delete("page");
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `/leases?${query}` : "/leases");
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, router]);

  return (
    <div className="space-y-2 max-w-xl">
      <Label htmlFor="lease-search">Search unit or tenant</Label>
      <div className="relative">
        <Input
          id="lease-search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="A-12-3 or Aisyah"
          className={q ? "h-9 pr-9" : "h-9"}
          aria-busy={pending}
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
