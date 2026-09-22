import { getSessionUser, hasValidOrigin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resetUserAccessSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const admin = await getSessionUser();
  if (!admin || admin.role !== "admin") return Response.json({ error: "Přístup jen pro správce." }, { status: 403 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = resetUserAccessSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Uživatel nebyl správně vybrán." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase.from("reporting_profiles").select("email,name").eq("id", parsed.data.userId).maybeSingle();
  if (!target) return Response.json({ error: "Uživatel nebyl nalezen." }, { status: 404 });
  const origin = new URL(request.url).origin;
  const { error } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${origin}/auth/callback?next=/nastavit-heslo`,
  });
  if (error) return Response.json({ error: "Obnovovací e-mail se nepodařilo odeslat." }, { status: 502 });
  const { error: setupError } = await supabase.rpc("reporting_admin_start_password_setup", { p_user_id: parsed.data.userId });
  if (setupError) return Response.json({ error: "Odkaz byl odeslán, ale nepodařilo se vynutit nastavení nového hesla." }, { status: 500 });
  return Response.json({ ok: true, message: `Uživateli ${target.name} byl odeslán odkaz pro nové heslo.` });
}
