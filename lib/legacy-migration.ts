import { eq, inArray } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/db";
import { reportItems, reports, users } from "@/db/schema";

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

export async function migrateLegacyDataForUser(
  supabase: SupabaseClient,
  authUserId: string,
  email: string,
) {
  const db = getDb();
  const legacyUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();

  if (!legacyUser) {
    await supabase.rpc("reporting_mark_legacy_migrated", { p_legacy_user_id: null });
    return;
  }

  const oldReports = await db
    .select()
    .from(reports)
    .where(eq(reports.userId, legacyUser.id));
  const reportIds = oldReports.map((report) => report.id);
  const oldItems = reportIds.length
    ? await db.select().from(reportItems).where(inArray(reportItems.reportId, reportIds))
    : [];
  const reportById = new Map(oldReports.map((report) => [report.id, report]));

  if (oldReports.length) {
    const { error } = await supabase.from("reporting_reports").upsert(
      oldReports.map((report) => ({
        id: report.id,
        user_id: authUserId,
        period_start: report.periodStart,
        period_end: report.periodEnd,
        summary: report.summary,
        sync_status: report.syncStatus,
        sync_error: report.syncError,
        legacy_id: report.id,
        created_at: iso(report.createdAt),
        updated_at: iso(report.updatedAt),
      })),
      { onConflict: "legacy_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const oldProjects = oldItems.filter((item) => item.type === "project" || item.type === "fall");
  if (oldProjects.length) {
    const { error } = await supabase.from("reporting_projects").upsert(
      oldProjects.map((item) => {
        const report = reportById.get(item.reportId)!;
        const state = item.status === "done" ? "completed" : item.status === "cancelled" ? "cancelled" : "active";
        return {
          id: item.id,
          owner_id: authUserId,
          source_report_id: item.reportId,
          period_start: report.periodStart,
          period_end: report.periodEnd,
          root_project_id: null,
          previous_project_id: null,
          name: item.personName,
          description: item.description,
          value: item.amount,
          unit: "BU",
          state,
          phase: item.status === "in_progress" ? "processing" : "new",
          due_date: item.dueDate,
          is_carryover: item.type === "fall",
          carried_from_value: item.type === "fall" ? item.amount : null,
          cancellation_reason: state === "cancelled" ? item.note || "Převedeno z původního reportu" : null,
          legacy_id: item.id,
          created_at: iso(item.createdAt),
          updated_at: iso(item.createdAt),
        };
      }),
      { onConflict: "legacy_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const oldAppointments = oldItems.filter((item) => item.type === "analysis" || item.type === "consulting");
  if (oldAppointments.length) {
    const { error } = await supabase.from("reporting_appointments").upsert(
      oldAppointments.map((item) => {
        const report = reportById.get(item.reportId)!;
        return {
          id: item.id,
          owner_id: authUserId,
          report_id: item.reportId,
          period_start: report.periodStart,
          period_end: report.periodEnd,
          type: item.type,
          client_name: item.personName,
          description: item.description,
          due_date: item.dueDate,
          due_time: item.dueTime,
          status: item.status === "done" || item.status === "cancelled" ? item.status : "scheduled",
          note: item.note,
          legacy_id: item.id,
          created_at: iso(item.createdAt),
          updated_at: iso(item.createdAt),
        };
      }),
      { onConflict: "legacy_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const { error } = await supabase.rpc("reporting_mark_legacy_migrated", {
    p_legacy_user_id: legacyUser.id,
  });
  if (error) throw error;
}
