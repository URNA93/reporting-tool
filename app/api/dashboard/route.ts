import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";
import { dashboardFilterSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = dashboardFilterSchema.safeParse({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    periodStart: url.searchParams.get("periodStart") || undefined,
    periodEnd: url.searchParams.get("periodEnd") || undefined,
    userId: url.searchParams.get("userId") || undefined,
    state: url.searchParams.get("state") || undefined,
    phase: url.searchParams.get("phase") || undefined,
    processStage: url.searchParams.get("processStage") || undefined,
    carryover: url.searchParams.get("carryover") || undefined,
    alert: url.searchParams.get("alert") || undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Filtry nejsou správně zadané." },
      { status: 400, headers: privateNoStoreHeaders },
    );
  }
  const data = await getDashboardData(user, parsed.data);
  return Response.json(data, { headers: privateNoStoreHeaders });
}
