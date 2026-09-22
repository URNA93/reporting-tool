import { getSessionUser, hasValidOrigin } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";
import { syncStoredReport } from "@/lib/report-sync";
import { syncSheetDeletion } from "@/lib/sheet-deletion-sync";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteReportSchema, reportSchema, updateReportSchema } from "@/lib/validation";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  return Response.json(await getDashboardData(user));
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Report není správně vyplněný." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: reportId, error } = await supabase.rpc("reporting_create_report", {
    p_summary: parsed.data.summary,
    p_items: parsed.data.items,
  });
  if (error || !reportId) return Response.json({ error: error?.message ?? "Report se nepodařilo uložit." }, { status: 400 });
  const sync = await syncStoredReport(supabase, reportId, user);
  const dashboard = await getDashboardData(user);
  return Response.json({
    ok: true,
    reportId,
    dashboard,
    syncStatus: sync.ok ? "synced" : sync.pending ? "pending" : "failed",
    message: sync.ok
      ? "Report byl uložen a zapsán do Google tabulky."
      : "Report je bezpečně uložený. Zápis do Google tabulky čeká na synchronizaci.",
  }, {
    status: 201,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
    },
  });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = updateReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Souhrn reportu není správně vyplněný." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase.from("reporting_reports").select("user_id").eq("id", parsed.data.reportId).maybeSingle();
  if (!current) return Response.json({ error: "Report nebyl nalezen." }, { status: 404 });
  if (current.user_id !== user.id && !user.canManageReports) return Response.json({ error: "K tomuto reportu nemáš přístup." }, { status: 403 });
  const { error } = await supabase
    .from("reporting_reports")
    .update({ summary: parsed.data.summary, sync_status: "pending", sync_error: null, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.reportId);
  if (error) return Response.json({ error: "Souhrn se nepodařilo uložit." }, { status: 400 });
  const { data: owner } = await supabase.from("reporting_profiles").select("id,email,name,role").eq("id", current.user_id).single();
  if (owner) await syncStoredReport(supabase, parsed.data.reportId, { ...user, ...owner });
  return Response.json({ ok: true, message: "Souhrn reportu byl upraven." });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = deleteReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Report nebyl správně vybrán." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reporting_delete_report", { p_report_id: parsed.data.reportId });
  if (error || !data) return Response.json({ error: error?.message ?? "Report nebyl nalezen." }, { status: 403 });
  const sheet = await syncSheetDeletion(supabase, "report", parsed.data.reportId);
  return Response.json({
    ok: true,
    sheetDeleted: sheet.ok,
    message: sheet.ok
      ? "Report a jeho položky byly odstraněny z přehledu i z Google tabulky."
      : "Report byl odstraněn z přehledu. Google tabulka se dokončí při další synchronizaci.",
  });
}
