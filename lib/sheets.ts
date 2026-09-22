import { env } from "cloudflare:workers";

type SyncItem = {
  id: string;
  type: string;
  personName: string;
  description: string;
  amount: number | null;
  unit: string | null;
  dueDate: string | null;
  dueTime: string | null;
  status: string;
  note: string;
  createdAt: Date;
};

type SyncReport = {
  id: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
};

type SyncUser = { email: string; name: string; role?: string };

const envValues = env as unknown as Record<string, string | undefined>;

type SheetResult = {
  ok: boolean;
  pending: boolean;
  error: string | null;
};

async function postToSheet(payload: Record<string, unknown>): Promise<SheetResult> {
  const url = envValues.GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = envValues.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) {
    return {
      ok: false,
      pending: true,
      error: "Google tabulka čeká na aktivaci zapisovacího můstku.",
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ secret, ...payload }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const responsePayload = (await response.json()) as { ok?: boolean; error?: string };
    if (!responsePayload.ok) {
      throw new Error(responsePayload.error || "Google tabulka zápis odmítla.");
    }
    return { ok: true, pending: false, error: null };
  } catch (error) {
    return {
      ok: false,
      pending: false,
      error: error instanceof Error ? error.message : "Neznámá chyba synchronizace",
    };
  }
}

export function syncReportToSheet(
  report: SyncReport,
  user: SyncUser,
  items: SyncItem[],
) {
  return postToSheet({ action: "report", report, user, items });
}

export function deleteItemFromSheet(itemId: string) {
  return postToSheet({ action: "delete_item", itemId });
}

export function deleteReportFromSheet(reportId: string) {
  return postToSheet({ action: "delete_report", reportId });
}
