import { getSessionUser, hasValidOrigin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { moveProjectProcessStageSchema } from "@/lib/validation";

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  if (!hasValidOrigin(request)) return Response.json({ error: "Neplatný požadavek." }, { status: 403 });
  const parsed = moveProjectProcessStageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Neplatná procesní fáze projektu." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reporting_move_project_process_stage", {
    p_project_id: parsed.data.itemId,
    p_target_stage: parsed.data.targetStage,
  });
  if (error || !data) return Response.json({ error: error?.message ?? "Projekt se nepodařilo přesunout." }, { status: 403 });
  return Response.json({ ok: true, message: `Projekt je nyní ve fázi ${parsed.data.targetStage === "analysis" ? "Analýza" : parsed.data.targetStage === "consulting" ? "Poradenství" : "Projekt"}.` });
}
