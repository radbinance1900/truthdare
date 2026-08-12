import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-safe Supabase client.
 * It uses only the public publishable key; row-level security protects data.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase public environment variables. Add them to .env.local.");
  }

  return createBrowserClient(url, key);
}
