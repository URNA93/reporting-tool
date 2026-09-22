import { getSessionUser, hasValidOrigin } from "@/lib/auth";
import { syncStoredReport } from "@/lib/report-sync";
import { syncSheetDeletion, type SheetDeletionAction } from "@/lib/sheet-deletion-sync";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const admin = await getSessionUser();
  if (!admin || admin.role !== "admin") return Response.json({ error: "Přístup jen pro správce." }, { status: 403 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  const { data: pending } = await supabase
    .from("reporting_reports")
    .select("id,user_id")
    .in("sync_status", ["pending", "failed"])
    .is("deleted_at", null)
    .limit(25);
  const { data: pendingDeletions, error: deletionQueryError } = await supabase.rpc("reporting_list_pending_sheet_deletions");
  if (deletionQueryError) return Response.json({ error: "Nepodařilo se načíst frontu mazání tabulky." }, { status: 400 });
  if (!pending?.length && !pendingDeletions?.length) return Response.json({ ok: true, synced: 0, failed: 0, message: "Tabulka je synchronizovaná." });
  const { data: profiles } = await supabase.from("reporting_profiles").select("id,email,name,role");
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  let synced = 0;
  let failed = 0;
  for (const report of pending) {
    const owner = byId.get(report.user_id);
    if (!owner) { failed += 1; continue; }
    const result = await syncStoredReport(supabase, report.id, owner);
    if (result.ok) synced += 1;
    else failed += 1;
  }
  for (const deletion of pendingDeletions ?? []) {
    const result = await syncSheetDeletion(supabase, deletion.action as SheetDeletionAction, deletion.target_id);
    if (result.ok) synced += 1;
    else failed += 1;
  }
  return Response.json({
    ok: failed === 0,
    synced,
    failed,
    message: failed === 0 ? `Do tabulky bylo zapsáno ${synced} reportů.` : `Zapsáno: ${synced}. Čeká nebo selhalo: ${failed}.`,
  });
}
