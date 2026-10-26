import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

/** Service-role client for seeding and privileged server jobs. Never expose to the browser. */
export function createAdminClient() {
  const { supabaseUrl, supabaseSecretKey } = getServerEnv();
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
