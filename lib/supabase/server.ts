import { env } from "cloudflare:workers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function config() {
  const values = env as unknown as Record<string, string | undefined>;
  const url = values.SUPABASE_URL;
  const key = values.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Chybí SUPABASE_URL nebo SUPABASE_PUBLISHABLE_KEY.");
  }
  return { url, key };
}

export async function createSupabaseServerClient() {
  const { url, key } = config();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (entries) => {
        try {
          for (const entry of entries) store.set(entry.name, entry.value, entry.options);
        } catch {
          // Server Components nemohou měnit cookies. Route Handlery je obnoví.
        }
      },
    },
  });
}

// Používá se jen pro systémové e-maily, aby ruční pozvánka nikdy nepřepsala
// aktuální přihlášení správce, který ji vytváří.
export function createSupabaseStatelessClient() {
  const { url, key } = config();
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function getSupabasePublicConfig() {
  return config();
}
