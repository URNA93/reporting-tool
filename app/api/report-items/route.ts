import { getSessionUser, hasValidOrigin } from "@/lib/auth";
import { syncSheetDeletion } from "@/lib/sheet-deletion-sync";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteReportItemSchema, updateReportItemSchema } from "@/lib/validation";

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = updateReportItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Položka není správně vyplněná." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  if (parsed.data.type === "project") {
    const { data: project } = await supabase
      .from("reporting_projects")
      .select("owner_id,source_report_id")
      .eq("id", parsed.data.itemId)
      .maybeSingle();
    if (!project) return Response.json({ error: "Projekt nebyl nalezen." }, { status: 404 });
    if (project.owner_id !== user.id && !user.canManageReports) return Response.json({ error: "K tomuto projektu nemáš přístup." }, { status: 403 });
    const { error } = await supabase.from("reporting_projects").update({
      name: parsed.data.personName,
      description: parsed.data.description,
      value: parsed.data.amount,
      state: parsed.data.status,
      phase: parsed.data.phase ?? "new",
      due_date: parsed.data.dueDate,
      cancellation_reason: parsed.data.status === "cancelled" ? parsed.data.note : null,
      updated_at: new Date().toISOString(),
    }).eq("id", parsed.data.itemId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (project.source_report_id) {
      await supabase.from("reporting_reports").update({ sync_status: "pending", sync_error: null, updated_at: new Date().toISOString() }).eq("id", project.source_report_id);
    }
    return Response.json({ ok: true, message: "Projekt byl upraven." });
  }

  const { data: appointment } = await supabase
    .from("reporting_appointments")
    .select("owner_id,report_id,type")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (!appointment) return Response.json({ error: "Termín nebyl nalezen." }, { status: 404 });
  if (appointment.owner_id !== user.id && !user.canManageReports) {
    return Response.json({ error: "K tomuto termínu nemáš přístup." }, { status: 403 });
  }
  if (appointment.type !== parsed.data.type) {
    const conversion = appointment.type === "analysis" && parsed.data.type === "consulting"
      ? "reporting_convert_analysis_to_consulting"
      : appointment.type === "consulting" && parsed.data.type === "analysis"
        ? "reporting_convert_consulting_to_analysis"
        : null;
    if (!conversion) return Response.json({ error: "Tento termín nelze do zvoleného typu přesunout." }, { status: 409 });
    const { error } = await supabase.rpc(conversion, {
      p_appointment_id: parsed.data.itemId,
      p_client_name: parsed.data.personName,
      p_description: parsed.data.description,
      p_value_bu: parsed.data.type === "consulting" ? parsed.data.amount : null,
      p_due_date: parsed.data.dueDate,
      p_due_time: parsed.data.dueTime,
      p_status: parsed.data.status,
      p_note: parsed.data.note,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, message: parsed.data.type === "consulting" ? "Analýza byla přesunuta do poradenství." : "Poradenství bylo vráceno do analýzy." });
  }
  const { error } = await supabase.rpc("reporting_update_appointment", {
    p_appointment_id: parsed.data.itemId,
    p_client_name: parsed.data.personName,
    p_description: parsed.data.description,
    p_value_bu: parsed.data.type === "consulting" ? parsed.data.amount : null,
    p_due_date: parsed.data.dueDate,
    p_due_time: parsed.data.dueTime,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true, message: "Termín byl upraven." });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = deleteReportItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Položka nebyla správně vybrána." }, { status: 400 });
  if (parsed.data.type === "fall") {
    return Response.json({ error: "Přepad nemaž. Uzavři nebo zruš ho v úpravě projektu." }, { status: 409 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reporting_delete_item", {
    p_item_id: parsed.data.itemId,
    p_item_type: parsed.data.type,
  });
  if (error || !data) return Response.json({ error: error?.message ?? "Položku nelze odstranit." }, { status: 403 });
  const sheet = await syncSheetDeletion(supabase, "item", parsed.data.itemId);
  return Response.json({
    ok: true,
    sheetDeleted: sheet.ok,
    message: sheet.ok
      ? "Položka byla odstraněna z přehledu i z Google tabulky."
      : "Položka byla odstraněna z přehledu. Google tabulka se dokončí při další synchronizaci.",
  });
}
