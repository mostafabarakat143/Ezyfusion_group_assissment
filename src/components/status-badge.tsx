import type { InvoiceStatus } from "@/lib/billing";
import { Badge } from "@/components/ui/badge";

const styles: Record<InvoiceStatus | string, string> = {
  paid: "bg-emerald-100 text-emerald-900",
  overdue: "bg-red-100 text-red-900",
  partially_paid: "bg-amber-100 text-amber-900",
  unpaid: "bg-slate-100 text-slate-800",
  pending_verification: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-red-100 text-red-900",
  voided: "bg-slate-100 text-slate-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={styles[status] ?? ""}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
