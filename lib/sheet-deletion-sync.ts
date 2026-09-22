import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteItemFromSheet, deleteReportFromSheet } from "@/lib/sheets";

export type SheetDeletionAction = "item" | "report";

export async function syncSheetDeletion(
  supabase: SupabaseClient,
  action: SheetDeletionAction,
  targetId: string,
) {
  const result = action === "item"
    ? await deleteItemFromSheet(targetId)
    : await deleteReportFromSheet(targetId);

  if (!result.ok) return result;
  const { error } = await supabase.rpc("reporting_complete_sheet_deletion", {
    p_action: action,
    p_target_id: targetId,
  });
  if (error) {
    return { ok: false, pending: false, error: "Položka byla smazána, ale potvrzení synchronizace selhalo." };
  }
  return result;
}
