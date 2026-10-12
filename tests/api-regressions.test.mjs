import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function load(path, requireShim) {
  const compiled = ts.transpileModule(await read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInThisContext(`(function(require, exports) { ${compiled}\n})`, { filename: path })(requireShim, exports);
  return exports;
}

test("the Google Sheet payload keeps the time of projects as well as appointments", async () => {
  let payload;
  const rows = {
    reporting_reports: { id: "r1", period_start: "2026-09-02", period_end: "2026-10-06", summary: "", created_at: "2026-09-02T08:00:00Z", updated_at: "2026-09-02T08:00:00Z" },
    reporting_projects: [{ id: "p1", name: "Projekt", description: "", value: 10, unit: "BU", due_date: "2026-09-10", due_time: "09:30:00", state: "active", is_carryover: false, cancellation_reason: null, created_at: "2026-09-02T08:00:00Z" }],
    reporting_appointments: [{ id: "a1", type: "consulting", client_name: "Klient", description: "", value_bu: 5, due_date: "2026-09-11", due_time: "14:00:00", status: "scheduled", note: "", created_at: "2026-09-02T08:00:00Z" }],
  };
  const chain = (table) => {
    const result = { data: rows[table], error: null };
    const builder = { select: () => builder, eq: () => builder, is: () => builder, update: () => builder, single: () => Promise.resolve(result), then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    return builder;
  };
  const { syncStoredReport } = await load("lib/report-sync.ts", (id) => {
    if (id === "@/lib/sheets") return { syncReportToSheet: async (_report, _user, items) => { payload = items; return { ok: true, pending: false, error: null }; } };
    if (id === "@/lib/supabase/server") return {};
    throw new Error(`Unexpected import: ${id}`);
  });

  await syncStoredReport({ from: chain }, "r1", { email: "a@b.cz", name: "A" });
  assert.equal(payload.find((item) => item.id === "p1").dueTime, "09:30");
  assert.equal(payload.find((item) => item.id === "a1").dueTime, "14:00");
});

test("a Supabase query builder has no .catch(); rollbacks must use then() so they really run", async () => {
  const route = await read("app/api/admin/users/route.ts");
  assert.doesNotMatch(route, /\.rpc\([^;]*\)\.catch\(/);
  assert.match(route, /reporting_admin_revoke_invitation[^;]*\.then\(/);
});

test("manual sync survives a failed report query while sheet deletions are queued", async () => {
  const route = await read("app/api/admin/sync/route.ts");
  assert.match(route, /for \(const report of pending \?\? \[\]\)/);
});

test("the dashboard is served only by the no-store /api/dashboard endpoint", async () => {
  const reports = await read("app/api/reports/route.ts");
  assert.doesNotMatch(reports, /export async function GET/);
});

test("the Termín filter offers 'S termínem' end to end and the table header sorts by due date", async () => {
  const validation = await read("lib/validation.ts");
  const dashboard = await read("components/DashboardApp.tsx");
  assert.match(validation, /alert: z\.enum\(\["no_due", "overdue", "with_due"\]\)/);
  assert.match(dashboard, /<SelectItem value="with_due">S termínem<\/SelectItem>/);
  assert.match(dashboard, /aria-sort=/);
  assert.match(dashboard, /sortByDue\(data\.items, dueSort\)/);
  assert.match(dashboard, /paginatedItems\.map/);
});

test("Nejbližší termíny are paged by 12 in the UI, not cut off by the server", async () => {
  const dashboard = await read("components/DashboardApp.tsx");
  const data = await read("lib/data.ts");
  assert.match(dashboard, /const SCHEDULE_PER_PAGE = 12/);
  assert.match(dashboard, /scheduleDays\.map/);
  assert.match(dashboard, /className="agenda"/);
  assert.match(dashboard, /aria-label="Stránkování termínů"/);
  assert.doesNotMatch(data, /upcomingAll\.slice\(/);
});
