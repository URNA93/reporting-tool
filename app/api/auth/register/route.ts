import { COMPANY_DOMAIN, hasValidOrigin, isCompanyEmail, normalizeEmail } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { registerSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Vyplň jméno, firemní e-mail, pozici a heslo o nejméně 10 znacích." }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.email);
  if (!isCompanyEmail(email)) return Response.json({ error: `Registrace je povolená jen pro firemní doménu ${COMPANY_DOMAIN || "nastavenou správcem"}.` }, { status: 403 });

  const supabase = await createSupabaseServerClient();
  if (parsed.data.invitationToken) {
    const { data: invitation, error: invitationError } = await supabase
      .rpc("reporting_get_invitation", { p_token: parsed.data.invitationToken })
      .maybeSingle();
    const inviteRecord = invitation as { email?: string } | null;
    if (invitationError || !inviteRecord?.email || normalizeEmail(inviteRecord.email) !== email) {
      return Response.json({ error: "Pozvánka neplatí, byla zrušená nebo patří jinému e-mailu." }, { status: 400 });
    }
  }
  const origin = new URL(request.url).origin;
  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/`,
      data: {
        name: parsed.data.name.trim(),
        position: parsed.data.position,
        app_source: "gfs_reporting",
        ...(parsed.data.invitationToken ? { invitation_token: parsed.data.invitationToken } : {}),
      },
    },
  });
  if (error) return Response.json({ error: error.message === "User already registered" ? "Účet už existuje. Přihlas se nebo si obnov heslo." : "Registraci se nepodařilo dokončit." }, { status: 400 });
  return Response.json({
    ok: true,
    requiresConfirmation: !data.session,
    message: data.session ? "Účet je připravený." : "Poslali jsme ti potvrzovací e-mail. Po potvrzení se můžeš přihlásit.",
  });
}
