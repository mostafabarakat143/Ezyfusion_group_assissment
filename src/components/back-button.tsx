import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BackButton({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: "default", size: "default" }),
        "gap-2",
      )}
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      Back
    </Link>
  );
}
