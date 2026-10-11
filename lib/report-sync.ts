import { syncReportToSheet } from "@/lib/sheets";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function syncStoredReport(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  reportId: string,
  user: { email: string; name: string; role?: string },
) {
  const [{ data: report }, { data: projects }, { data: appointments }] = await Promise.all([
    supabase.from("reporting_reports").select("*").eq("id", reportId).single(),
    supabase.from("reporting_projects").select("*").eq("source_report_id", reportId).is("deleted_at", null),
    supabase.from("reporting_appointments").select("*").eq("report_id", reportId).is("deleted_at", null),
  ]);
  if (!report) return { ok: false, pending: false, error: "Report nebyl nalezen." };
  const items = [
    ...(projects ?? []).map((item) => ({
      id: item.id, type: item.is_carryover ? "fall" : "project", personName: item.name,
      description: item.description, amount: item.value === null ? null : Number(item.value), unit: item.unit,
      dueDate: item.due_date, dueTime: item.due_time ? String(item.due_time).slice(0, 5) : null, status: item.state, note: item.cancellation_reason ?? "", createdAt: new Date(item.created_at),
    })),
    ...(appointments ?? []).map((item) => ({
      id: item.id, type: item.type, personName: item.client_name, description: item.description,
      amount: item.type === "consulting" && item.value_bu !== null ? Number(item.value_bu) : null,
      unit: item.type === "consulting" && item.value_bu !== null ? "BU" : null,
      dueDate: item.due_date, dueTime: item.due_time ? String(item.due_time).slice(0, 5) : null,
      status: item.status, note: item.note, createdAt: new Date(item.created_at),
    })),
  ];
  const sync = await syncReportToSheet({
    id: report.id, periodStart: report.period_start, periodEnd: report.period_end, summary: report.summary,
    createdAt: new Date(report.created_at), updatedAt: new Date(report.updated_at),
  }, user, items);
  await supabase.from("reporting_reports").update({
    sync_status: sync.ok ? "synced" : sync.pending ? "pending" : "failed",
    sync_error: sync.error,
    updated_at: new Date().toISOString(),
  }).eq("id", reportId);
  return sync;
}
