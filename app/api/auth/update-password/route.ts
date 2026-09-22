import { hasValidOrigin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { passwordUpdateSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = passwordUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Heslo musí mít nejméně 10 znaků." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return Response.json({ error: "Obnovovací odkaz není platný nebo vypršel." }, { status: 401 });
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return Response.json({ error: "Nové heslo se nepodařilo uložit." }, { status: 400 });
  const { error: setupError } = await supabase.rpc("reporting_complete_password_setup");
  if (setupError) return Response.json({ error: "Heslo je uložené, ale přístup se nepodařilo dokončit. Zkus to prosím ještě jednou." }, { status: 500 });
  return Response.json({ ok: true });
}
