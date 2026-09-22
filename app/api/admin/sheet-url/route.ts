import { env } from "cloudflare:workers";
import { getSessionUser } from "@/lib/auth";

const values = env as unknown as Record<string, string | undefined>;

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Přístup jen pro správce." }, { status: 403 });
  }

  const configuredUrl = values.GOOGLE_SHEETS_SPREADSHEET_URL?.trim();
  if (!configuredUrl) return Response.json({ url: null });

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
      throw new Error("invalid sheet URL");
    }
    return Response.json({ url: url.toString() });
  } catch {
    return Response.json({ url: null });
  }
}
