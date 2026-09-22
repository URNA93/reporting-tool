import { hasValidOrigin, isAllowedLoginEmail, normalizeEmail } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Vyplň e-mail a heslo." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  if (!isAllowedLoginEmail(email)) return Response.json({ error: "Tento účet nemá k aplikaci přístup." }, { status: 403 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) return Response.json({ error: "Nesprávný e-mail, heslo nebo nepotvrzený e-mail." }, { status: 401 });
  const { data: profile } = await supabase.from("reporting_profiles").select("status,requires_password_setup").eq("id", data.user.id).maybeSingle();
  if (profile?.status === "disabled") {
    await supabase.auth.signOut();
    return Response.json({ error: "Tento účet je vypnutý správcem." }, { status: 403 });
  }
  return Response.json({ ok: true, requiresPasswordSetup: Boolean(profile?.requires_password_setup) });
}
