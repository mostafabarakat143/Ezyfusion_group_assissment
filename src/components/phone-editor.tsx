"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PhoneEditor({
  tenantId,
  initialPhone,
}: {
  tenantId: string;
  initialPhone: string | null;
}) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [loading, setLoading] = useState(false);

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from("tenants")
        .update({ phone: phone.trim() || null })
        .eq("id", tenantId);
      if (error) {
        throw new Error(error.message);
      }
      toast.success("Phone number updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSave} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="space-y-2 flex-1">
        <Label htmlFor="phone">Phone number</Label>
        <Input
          id="phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+60…"
        />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Saving…" : "Save phone"}
      </Button>
    </form>
  );
}
