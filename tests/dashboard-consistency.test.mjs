import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import * as deadline from "../lib/deadline.ts";

// Logic checks for the dashboard loader: the numbers on the cards, the banner,
// the drill-down filters and the table must always describe the same items.
// Runs the production lib/data.ts against an in-memory PostgREST emulation.
const source = await readFile(new URL("../lib/data.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const factory = runInThisContext(`(function(require, exports) { ${compiled}\n})`, {
  filename: "lib/data.ts",
});

const managerId = "11111111-1111-4111-8111-111111111111";
const manager = {
  id: managerId, name: "Manager", email: "manager@gfsgroup.cz", position: "TM",
  role: "manager", status: "active", canManageReports: true, canViewAll: true,
};
const PERIOD = { period_start: "2026-09-02", period_end: "2026-10-06", deleted_at: null };

function project(id, overrides = {}) {
  return {
    ...PERIOD, id, owner_id: managerId, source_report_id: null, previous_project_id: null,
    name: id, description: "", value: 100, unit: "BU", state: "active", phase: "new",
    process_stage: "project", due_date: null, due_time: null, is_carryover: false, ...overrides,
  };
}
function appointment(id, overrides = {}) {
  return {
    ...PERIOD, id, owner_id: managerId, report_id: null, type: "consulting", client_name: id,
    description: "", value_bu: 10, due_date: null, due_time: null, status: "scheduled",
    note: "", ...overrides,
  };
}

function harness({ projects = [], appointments = [] }) {
  const rows = {
    reporting_profiles: [{ id: managerId, name: "Manager", email: manager.email, status: "active", role: "manager", position: "TM" }],
    reporting_reports: [],
    reporting_projects: projects,
    reporting_appointments: appointments,
  };
  const client = createClient("https://reporting-tests.invalid", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname.endsWith("/rpc/reporting_sync_current_carryovers")) return Response.json(0);
        const table = url.pathname.split("/").at(-1);
        let data = rows[table];
        assert.ok(data, `Unexpected table: ${table}`);
        for (const [column, filter] of url.searchParams) {
          if (["select", "order", "limit"].includes(column)) continue;
          const separator = filter.indexOf(".");
          const operation = filter.slice(0, separator);
          const value = filter.slice(separator + 1);
          data = data.filter((row) => {
            switch (operation) {
              case "eq": return String(row[column]) === value;
              case "neq": return String(row[column]) !== value;
              case "is": return value === "null" && row[column] === null;
              case "not":
                if (value !== "is.null") throw new Error(`Unexpected filter: ${filter}`);
                return row[column] !== null;
              case "gte": return row[column] >= value;
              case "lte": return row[column] <= value;
              case "lt": return row[column] < value;
              default: throw new Error(`Unexpected filter: ${filter}`);
            }
          });
        }
        return Response.json(data);
      },
    },
  });
  const exports = {};
  factory((id) => {
    if (id === "@/lib/auth") return { MASTER_ADMIN_EMAIL: "master@example.invalid", normalizeEmail: (email) => email.trim().toLowerCase() };
    if (id === "@/lib/supabase/server") return { createSupabaseServerClient: async () => client };
    if (id === "@/lib/deadline") return deadline;
    throw new Error(`Unexpected import: ${id}`);
  }, exports);
  return (filters) => exports.getDashboardData(manager, filters);
}

const ids = (data) => data.items.map((item) => item.id).sort();

test("Blízké termíny shows the real number of upcoming items, not the 12-row list cap", async () => {
  const projects = Array.from({ length: 15 }, (_, index) =>
    project(`p${index}`, { due_date: `2099-01-${String(index + 1).padStart(2, "0")}` }));
  const data = await harness({ projects })();

  assert.equal(data.upcoming.length, 12, "the list itself stays capped at 12 rows");
  assert.equal(data.metrics.upcomingMeetings, 15);
});

test("the overdue count and the overdue filter describe the same items, appointments included", async () => {
  const load = harness({
    projects: [project("late-project", { due_date: "2000-01-01" }), project("fine-project", { due_date: "2099-01-01" })],
    appointments: [
      appointment("late-consulting", { due_date: "2000-02-01" }),
      appointment("late-but-done", { due_date: "2000-02-01", status: "done" }),
      appointment("fine-consulting", { due_date: "2099-02-01" }),
    ],
  });

  const unfiltered = await load();
  const filtered = await load({ alert: "overdue" });

  assert.deepEqual(ids(filtered), ["late-consulting", "late-project"]);
  assert.equal(unfiltered.metrics.overdueItems, 2);
  assert.equal(filtered.metrics.overdueItems, filtered.items.length);
});

test("the no-due count, the no-due volume card and the no-due drill-down describe the same items", async () => {
  const load = harness({
    projects: [project("undated-project", { value: 100 }), project("dated-project", { due_date: "2099-01-01", value: 40 })],
    appointments: [
      appointment("undated-consulting", { value_bu: 25 }),
      appointment("dated-consulting", { due_date: "2099-02-01", value_bu: 7 }),
    ],
  });

  const unfiltered = await load();
  const drilledDown = await load({ alert: "no_due" });

  // Clicking the "Objem projektů bez termínu" card must list everything it adds up.
  assert.equal(unfiltered.metrics.projectVolumeWithoutDueDate, 125);
  assert.deepEqual(ids(drilledDown), ["undated-consulting", "undated-project"]);
  assert.equal(drilledDown.metrics.projectVolumeWithoutDueDate, 125);
  assert.equal(unfiltered.metrics.noDueItems, 2);
  assert.equal(drilledDown.metrics.noDueItems, 2);
});

test("for every filter combination the cards and banner describe exactly the items in the table", async () => {
  const load = harness({
    projects: [
      project("a", { due_date: "2000-01-01" }),
      project("b", { due_date: "2099-01-01", value: 30 }),
      project("c", { process_stage: "analysis", value: 60 }),
      project("d", { state: "completed", due_date: "2000-03-01", value: 5 }),
    ],
    appointments: [
      appointment("e", { due_date: "2000-02-01", value_bu: 12 }),
      appointment("f", { due_date: "2099-02-01", value_bu: 8 }),
      appointment("g", { type: "analysis", value_bu: null }),
      appointment("h", { type: "intro", value_bu: null, due_date: "2099-03-01", due_time: "10:00" }),
      appointment("i", { status: "done", due_date: "2000-04-01" }),
    ],
  });

  for (const filters of [
    undefined, { state: "active" }, { state: "completed" }, { state: "cancelled" },
    { processStage: "project" }, { processStage: "analysis" }, { processStage: "consulting" }, { processStage: "intro" },
    { alert: "overdue" }, { alert: "no_due" }, { alert: "with_due" }, { from: "2000-01-01", to: "2050-01-01" }, { from: "2099-01-01" },
    { periodStart: "2026-09-02", periodEnd: "2026-10-06" }, { alert: "overdue", processStage: "consulting" },
  ]) {
    const data = await load(filters);
    const label = JSON.stringify(filters);
    const open = data.items.filter((item) => item.status === "active" || item.status === "scheduled");

    assert.equal(data.metrics.overdueItems, open.filter((item) => deadline.isOverdue(item)).length, `overdue ${label}`);
    assert.equal(data.metrics.noDueItems, open.filter((item) => !item.dueDate).length, `no due ${label}`);
    assert.equal(
      data.metrics.activeProjects,
      data.items.filter((item) => (item.type === "project" || item.type === "fall") && item.status === "active").length,
      `active projects ${label}`,
    );
    assert.equal(
      data.metrics.upcomingMeetings,
      open.filter((item) => item.dueDate && item.dueDate >= deadline.todayInPrague()).length,
      `upcoming ${label}`,
    );
    if (filters?.alert === "overdue") assert.ok(data.items.every((item) => deadline.isOverdue(item)), `overdue rows ${label}`);
    if (filters?.alert === "no_due") assert.ok(data.items.every((item) => !item.dueDate), `no-due rows ${label}`);
    if (filters?.alert === "with_due") assert.ok(data.items.every((item) => item.dueDate && (item.status === "active" || item.status === "scheduled")), `with-due rows ${label}`);
  }
});

test("'S termínem' and 'Bez termínu' split the open items exactly, with no overlap and no gap", async () => {
  const load = harness({
    projects: [
      project("dated", { due_date: "2099-01-01" }), project("undated"),
      project("done-dated", { state: "completed", due_date: "2099-01-02" }),
    ],
    appointments: [
      appointment("meeting-dated", { due_date: "2099-02-01" }), appointment("meeting-undated"),
      appointment("meeting-done", { due_date: "2099-02-02", status: "done" }),
    ],
  });

  const withDue = ids(await load({ alert: "with_due" }));
  const noDue = ids(await load({ alert: "no_due" }));
  const allOpen = ids(await load());

  assert.deepEqual(withDue, ["dated", "meeting-dated"]);
  assert.deepEqual(noDue, ["meeting-undated", "undated"]);
  assert.deepEqual([...withDue, ...noDue].sort(), allOpen);
});
