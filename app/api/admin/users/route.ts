import { COMPANY_DOMAIN, getSessionUser, hasValidOrigin, isCompanyEmail, MASTER_ADMIN_EMAIL, normalizeEmail } from "@/lib/auth";
import { currentReportingPeriod } from "@/lib/reporting-period";
import { createSupabaseServerClient, createSupabaseStatelessClient } from "@/lib/supabase/server";
import { createInvitationSchema, revokeInvitationSchema, updateUserSchema } from "@/lib/validation";

async function requireAdmin() {
  const user = await getSessionUser();
  return user?.role === "admin" ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) return Response.json({ error: "Přístup jen pro správce." }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  const { data: users, error } = await supabase
    .from("reporting_profiles")
    .select("id,email,name,position,role,status,requires_password_setup,created_at,updated_at")
    .order("name");
  if (error) return Response.json({ error: "Uživatele se nepodařilo načíst." }, { status: 500 });
  const masterUserId = (users ?? []).find((user) => normalizeEmail(user.email) === MASTER_ADMIN_EMAIL)?.id;
  const visibleUsers = (users ?? []).filter((user) => normalizeEmail(user.email) !== MASTER_ADMIN_EMAIL);
  const { data: invitations } = await supabase
    .from("reporting_invitations")
    .select("id,email,name,position,role,invite_token,created_at")
    .is("revoked_at", null)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  const [periodStart, periodEnd] = currentReportingPeriod();
  const { data: reports } = await supabase
    .from("reporting_reports")
    .select("user_id")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .is("deleted_at", null);
  const visibleReports = (reports ?? []).filter((report) => report.user_id !== masterUserId);
  const counts = new Map<string, number>();
  for (const report of visibleReports) counts.set(report.user_id, (counts.get(report.user_id) ?? 0) + 1);
  return Response.json({
    users: visibleUsers.map((user) => ({ ...user, currentPeriodReports: counts.get(user.id) ?? 0 })),
    invitations: invitations ?? [],
    stats: { currentPeriodReports: visibleReports.length, periodStart, periodEnd },
  });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return Response.json({ error: "Přístup jen pro správce." }, { status: 403 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = createInvitationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Doplň jméno, firemní e-mail, pozici a roli." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  if (!isCompanyEmail(email)) return Response.json({ error: `Použij firemní e-mail s doménou ${COMPANY_DOMAIN || "nastavenou správcem"}.` }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reporting_admin_create_invitation", {
    p_email: email,
    p_name: parsed.data.name,
    p_position: parsed.data.position,
    p_role: parsed.data.role,
  });
  const invitation = data as { id?: string; invite_token?: string } | null;
  if (error || !invitation?.id || !invitation.invite_token) return Response.json({ error: error?.message ?? "Pozvánku se nepodařilo vytvořit." }, { status: 400 });

  // Heslo je pouze jednorázový náhodný údaj pro založení Auth účtu. Nikam se
  // neukládá ani nezobrazuje; uživatel si ho nastaví až z e-mailového odkazu.
  const temporaryPassword = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("") + "Aa1!";
  const origin = new URL(request.url).origin;
  const auth = createSupabaseStatelessClient();
  const { data: signup, error: signupError } = await auth.auth.signUp({
    email,
    password: temporaryPassword,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/nastavit-heslo`,
      data: {
        name: parsed.data.name.trim(),
        position: parsed.data.position,
        app_source: "gfs_reporting",
        invitation_token: invitation.invite_token,
      },
    },
  });

  if (signupError || !signup.user || signup.user.identities?.length === 0) {
    await supabase.rpc("reporting_admin_revoke_invitation", { p_invitation_id: invitation.id }).catch(() => undefined);
    return Response.json({ error: "Účet se nepodařilo připravit. Zkontroluj e-mail a zkus to znovu." }, { status: 400 });
  }

  // U projektů bez potvrzování e-mailu Supabase po registraci odkaz neposílá.
  // V takovém případě odešleme stejný bezpečný tok přes obnovu hesla.
  if (signup.session) {
    const { error: recoveryError } = await auth.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/nastavit-heslo`,
    });
    if (recoveryError) return Response.json({ error: "Účet vznikl, ale e-mail s odkazem se nepodařilo odeslat. Použij u něj Nové heslo." }, { status: 502 });
  }

  return Response.json({
    invitation,
    message: `Člověk byl přidán a na ${email} jsme odeslali odkaz pro nastavení hesla.`,
  });
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin())) return Response.json({ error: "Přístup jen pro správce." }, { status: 403 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tuto změnu nelze provést." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reporting_admin_update_profile", {
    p_user_id: parsed.data.userId,
    p_name: parsed.data.name,
    p_position: parsed.data.position,
    p_role: parsed.data.role,
    p_status: parsed.data.status,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin())) return Response.json({ error: "Přístup jen pro správce." }, { status: 403 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = revokeInvitationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Neplatná pozvánka." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reporting_admin_revoke_invitation", { p_invitation_id: parsed.data.invitationId });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
