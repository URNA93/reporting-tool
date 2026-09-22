import { hasValidOrigin, isAllowedLoginEmail, normalizeEmail } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { passwordResetRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = passwordResetRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isAllowedLoginEmail(parsed.data.email)) return Response.json({ error: "Vyplň platný e-mail účtu." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  const origin = new URL(request.url).origin;
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/nastavit-heslo`,
  });
  return Response.json({ ok: true, message: "Pokud účet existuje, přijde na něj odkaz pro nastavení nového hesla." });
}
