import { hasValidOrigin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}
