import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

// Execute the production loader, with only its auth/config dependencies replaced.
// The real Supabase query builder serializes filters; no live accounts are used.
import * as deadline from "../lib/deadline.ts";

const source = await readFile(new URL("../lib/data.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const factory = runInThisContext(`(function(require, exports) { ${compiled}\n})`, {
  filename: "lib/data.ts",
});

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const masterId = "33333333-3333-4333-8333-333333333333";
const masterEmail = "master@example.invalid";
const ownUser = {
  id: ownerId, name: "Test owner", email: "owner@gfsgroup.cz", position: "T",
  role: "user", status: "active", canManageReports: false, canViewAll: false,
};
const masterUser = { ...ownUser, id: masterId, email: masterEmail, role: "admin", canManageReports: true };
const managerUser = { ...ownUser, role: "manager", canManageReports: true };

function fixture(user, { empty = false, withAppointments = false, appointmentType = "consulting", appointmentDueDate = "2026-09-09", projectState = "active", projectPhase = "new", projectStates = [], projectDueDates = [], projectStages = [] } = {}) {
  const period = { period_start: "2026-09-02", period_end: "2026-10-06", deleted_at: null };
  const profile = (id, email) => ({ id, name: id, email, status: "active", role: "user", position: "T" });
  const profiles = [profile(ownerId, ownUser.email), profile(otherId, "other@gfsgroup.cz")];
  if (user.id === masterId) profiles.push(profile(masterId, masterEmail));
  const report = (id, user_id) => ({ ...period, id, user_id, summary: "", sync_status: "synced" });
  const project = (id, owner_id, source_report_id, value, index) => ({
    ...period, id, owner_id, source_report_id, name: id, description: "", value,
    unit: "BU", state: projectStates[index] ?? projectState, phase: projectPhase,
    process_stage: projectStages[index] ?? "project", due_date: projectDueDates[index] ?? null, is_carryover: false,
  });
  const appointment = (id, owner_id, report_id, status) => ({
    ...period, id, owner_id, report_id, type: appointmentType, client_name: id, description: "", value_bu: appointmentType === "consulting" ? 10 : null,
    due_date: appointmentDueDate, due_time: "10:00", status, note: "",
  });
  const rows = {
    reporting_profiles: user.canManageReports ? profiles : profiles.filter((p) => p.id === user.id),
    reporting_reports: empty ? [] : [report("own-report", ownerId), report("other-report", otherId), report("archived-report", masterId)],
    reporting_projects: empty ? [] : [
      project("own-a", ownerId, "own-report", 100, 0),
      project("own-b", ownerId, "own-report", 200, 1),
      project("other-a", otherId, "other-report", 50, 2),
      project("archived-a", masterId, "archived-report", 500, 3),
    ],
    reporting_appointments: withAppointments ? [
      appointment("own-scheduled", ownerId, "own-report", "scheduled"),
      appointment("own-done", ownerId, "own-report", "done"),
    ] : [],
  };
  const requests = [];
  const client = createClient("https://reporting-tests.invalid", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push(url);
        if (url.pathname.endsWith("/rpc/reporting_sync_current_carryovers")) return Response.json(0);
        const table = url.pathname.split("/").at(-1);
        assert.ok(rows[table], `Unexpected table: ${table}`);
        let data = rows[table];
        // Emulate the already verified RLS: own rows for users; hidden master for managers.
        if (table !== "reporting_profiles") data = data.filter((row) => {
          const id = row.owner_id ?? row.user_id;
          return user.id === masterId || (user.canManageReports ? id !== masterId : id === user.id);
        });
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
    if (id === "@/lib/auth") return { MASTER_ADMIN_EMAIL: masterEmail, normalizeEmail: (email) => email.trim().toLowerCase() };
    if (id === "@/lib/supabase/server") return { createSupabaseServerClient: async () => client };
    if (id === "@/lib/deadline") return deadline;
    throw new Error(`Unexpected import: ${id}`);
  }, exports);
  return { load: (filters) => exports.getDashboardData(user, filters), requests };
}

function assertOwnDashboard(data) {
  assert.equal(data.metrics.activeProjects, 2);
  assert.equal(data.metrics.projectVolumes.BU, 300);
  assert.deepEqual(data.items.map((item) => item.id), ["own-a", "own-b"]);
  assert.ok(data.items.every((item) => item.ownerId === ownerId && item.canEdit));
  assert.equal(data.reports.length, 1);
  assert.equal(data.reports[0].userId, ownerId);
  assert.equal(data.reports[0].itemCount, 2);
}

test("owner sees and can edit both projects when the master is hidden and no filter is supplied", async () => {
  const { load, requests } = fixture(ownUser);
  assertOwnDashboard(await load());
  assert.ok(requests.some((url) => url.searchParams.get("owner_id") === `eq.${ownerId}`));
});

test("an API request with an absent userId returns the owner's reports", async () => {
  assertOwnDashboard(await fixture(ownUser).load({ userId: undefined }));
});

test("an explicit null userId returns the same owner dashboard", async () => {
  assertOwnDashboard(await fixture(ownUser).load({ userId: null }));
});

test("a forged person filter cannot select another user's projects", async () => {
  assertOwnDashboard(await fixture(ownUser).load({ userId: otherId }));
});

test("a manager's unfiltered overview works without access to the hidden master profile", async () => {
  const data = await fixture(managerUser).load();
  assert.equal(data.metrics.activeProjects, 3);
  assert.equal(data.reports.length, 2);
  assert.ok(data.people.every((person) => person.id !== masterId));
});

test("person, reporting period and state filters remain combinable for a manager", async () => {
  const { load } = fixture(managerUser);
  assertOwnDashboard(await load({ userId: ownerId, periodStart: "2026-09-02", periodEnd: "2026-10-06", state: "active" }));
  assert.equal((await load({ userId: ownerId, from: "2026-10-07" })).items.length, 0);
});

test("a dated appointment appears in the reporting period containing its due date", async () => {
  const { load } = fixture(managerUser, {
    withAppointments: true,
    appointmentDueDate: "2026-10-30",
  });

  const data = await load({ userId: ownerId, periodStart: "2026-10-07", periodEnd: "2026-11-03", state: "active" });
  assert.deepEqual(data.items.map((item) => item.id), ["own-scheduled"]);
  assert.equal(data.metrics.projectVolumes.BU, 10);
  assert.equal(data.metrics.upcomingMeetings, 1);
});

test("manager can filter another user's introductory conversations", async () => {
  const { load } = fixture(managerUser, {
    withAppointments: true,
    appointmentType: "intro",
    appointmentDueDate: "2099-09-25",
  });

  const data = await load({ userId: ownerId, processStage: "intro" });
  assert.deepEqual(data.items.map((item) => item.type), ["intro"]);
  assert.equal(data.reports[0].itemCount, 1);
  assert.equal(data.metrics.upcomingMeetings, 1);
  assert.equal(data.metrics.projectVolumes.BU ?? 0, 0);
});

test("a project keeps its type and appears among upcoming terms after moving to analysis or consulting", async () => {
  const { load } = fixture(managerUser, {
    projectDueDates: ["2026-10-30", "2026-11-01"],
    projectStages: ["analysis", "consulting"],
  });

  const data = await load({ userId: ownerId, periodStart: "2026-10-07", periodEnd: "2026-11-03", state: "active" });
  assert.deepEqual(data.items.map((item) => item.id), ["own-a", "own-b"]);
  assert.deepEqual(data.items.map((item) => item.type), ["project", "project"]);
  assert.deepEqual(data.items.map((item) => item.processStage), ["analysis", "consulting"]);
  assert.deepEqual(data.upcoming.map((item) => item.id), ["own-a", "own-b"]);
  assert.deepEqual(data.upcoming.map((item) => item.processStage), ["analysis", "consulting"]);
});

test("OD and DO filter due dates, and metrics follow the exact same item selection", async () => {
  const { load } = fixture(managerUser, {
    withAppointments: true,
    projectDueDates: ["2026-09-05", "2026-09-12", "2026-09-18", "2026-09-20"],
  });

  const throughNinth = await load({ userId: ownerId, to: "2026-09-09", state: "active" });
  assert.deepEqual(throughNinth.items.map((item) => item.id), ["own-a", "own-scheduled"]);
  assert.equal(throughNinth.metrics.projectVolumes.BU, 110);
  assert.equal(throughNinth.metrics.projectVolumeWithDueDate, 110);
  assert.equal(throughNinth.metrics.projectVolumeWithoutDueDate, 0);
  assert.equal(throughNinth.reports[0].itemCount, 2);

  const fromTenth = await load({ userId: ownerId, from: "2026-09-10", state: "active" });
  assert.deepEqual(fromTenth.items.map((item) => item.id), ["own-b"]);
  assert.equal(fromTenth.metrics.projectVolumes.BU, 200);
  assert.equal(fromTenth.reports[0].itemCount, 1);
});

test("the no-due filter is a shared selection for items, metrics, reports and upcoming terms", async () => {
  const { load } = fixture(managerUser, {
    withAppointments: true,
    projectDueDates: ["2026-09-05", null, "2026-09-18", "2026-09-20"],
  });
  const data = await load({ userId: ownerId, alert: "no_due" });

  assert.deepEqual(data.items.map((item) => item.id), ["own-b"]);
  assert.equal(data.metrics.projectVolumes.BU, 200);
  assert.equal(data.metrics.projectVolumeWithDueDate, 0);
  assert.equal(data.metrics.projectVolumeWithoutDueDate, 200);
  assert.equal(data.metrics.upcomingMeetings, 0);
  assert.equal(data.reports[0].itemCount, 1);
});

test("the overdue filter uses Prague's ISO date and returns only active projects past their due date", async () => {
  const { load } = fixture(managerUser, {
    projectDueDates: ["2000-01-01", "2099-01-01", "2099-01-01", "2099-01-01"],
  });
  const data = await load({ alert: "overdue" });

  assert.deepEqual(data.items.map((item) => item.id), ["own-a"]);
  assert.equal(data.metrics.projectVolumes.BU, 100);
  assert.equal(data.metrics.overdueItems, 1);
  assert.equal(data.reports[0].itemCount, 1);
  assert.equal(data.upcoming.length, 0);
});

test("active projects are split exclusively by due date and completed projects stay out of the default view", async () => {
  const { load } = fixture(managerUser, {
    projectPhase: "signature",
    projectStates: ["active", "active", "completed", "active"],
    projectDueDates: ["2026-09-09", null, "2026-09-10", "2026-09-11"],
  });

  const defaultView = await load();
  assert.equal(defaultView.metrics.projectVolumeWithDueDate, 100);
  assert.equal(defaultView.metrics.projectVolumeWithoutDueDate, 200);
  assert.ok(defaultView.items.every((item) => item.status === "active" || item.type !== "project"));

  const signed = await load({ state: "completed", phase: "signature" });
  assert.deepEqual(signed.items.map((item) => item.id), ["other-a"]);
  assert.equal(signed.metrics.projectVolumeWithDueDate, 0);
  assert.equal(signed.metrics.projectVolumeWithoutDueDate, 0);
});

test("state filter also maps appointment states and excludes scheduled appointments from completed", async () => {
  const { load } = fixture(managerUser, { withAppointments: true });

  const completed = await load({ userId: ownerId, state: "completed" });
  assert.deepEqual(completed.items.map((item) => item.id), ["own-done"]);
  assert.equal(completed.reports.length, 1);

  const active = await load({ userId: ownerId, state: "active" });
  assert.ok(active.items.some((item) => item.id === "own-scheduled"));
  assert.ok(active.items.every((item) => item.id !== "own-done"));
});

test("project metrics include signed completed volume when the overview is filtered", async () => {
  const { load } = fixture(managerUser, { projectState: "completed", projectPhase: "signature" });
  const data = await load({ userId: ownerId, state: "completed", phase: "signature" });

  assert.equal(data.metrics.activeProjects, 0);
  assert.equal(data.metrics.projectVolumes.BU, 300);
  assert.equal(data.metrics.projectCountLabel, "Projekty ve výběru");
});

test("scheduled consulting is included in the project volume bucket matching its due date", async () => {
  const { load } = fixture(managerUser, { withAppointments: true });
  const data = await load({ userId: ownerId, state: "active" });

  assert.equal(data.metrics.projectVolumes.BU, 310);
  assert.equal(data.metrics.projectVolumeWithDueDate, 10);
  assert.equal(data.metrics.projectVolumeWithoutDueDate, 300);
});

test("project-only filters do not leak analyses or consulting into the project list", async () => {
  const { load } = fixture(managerUser, { withAppointments: true });
  const data = await load({ userId: ownerId, phase: "new" });

  assert.ok(data.items.every((item) => item.type === "project"));
});

test("master overview still excludes the master profile and its archived reports", async () => {
  const data = await fixture(masterUser).load();
  assert.equal(data.metrics.activeProjects, 3);
  assert.ok(data.people.every((person) => person.id !== masterId));
  assert.ok(data.reports.every((report) => report.userId !== masterId));
  assert.ok(data.items.every((item) => item.ownerId !== masterId));
});

test("explicit selection of the hidden master still produces no visible reports", async () => {
  const data = await fixture(masterUser).load({ userId: masterId });
  assert.equal(data.items.length, 0);
  assert.equal(data.reports.length, 0);
});

test("an actually empty account remains empty", async () => {
  const data = await fixture(ownUser, { empty: true }).load();
  assert.equal(data.items.length, 0);
  assert.equal(data.reports.length, 0);
});


test("past period overdue filter includes scheduled appointments and projects in every process", async () => {
  for (const appointmentType of ["analysis", "consulting", "intro"]) {
    const { load } = fixture(managerUser, {
      withAppointments: true, appointmentType, appointmentDueDate: "2000-09-10",
      projectDueDates: ["2000-09-09", "2000-10-20", "2000-09-11"],
    });
    const data = await load({ userId: ownerId, periodStart: "2000-09-01", periodEnd: "2000-09-30", alert: "overdue" });
    assert.deepEqual(data.items.map((item) => item.id), ["own-a", "own-scheduled"]);
    assert.equal(data.metrics.projectVolumeWithDueDate, appointmentType === "consulting" ? 110 : 100);
    assert.equal(data.metrics.projectVolumes.BU, appointmentType === "consulting" ? 110 : 100);
    assert.equal(data.upcoming.length, 0);
    const stageOnly = await load({ userId: ownerId, periodStart: "2000-09-01", periodEnd: "2000-09-30", alert: "overdue", processStage: appointmentType });
    assert.deepEqual(stageOnly.items.map((item) => item.id), ["own-scheduled"]);
  }
});

test("overdue appointment selection still respects dates, completion and project-only filters", async () => {
  const { load } = fixture(managerUser, { withAppointments: true, appointmentDueDate: "2000-09-10" });
  assert.equal((await load({ alert: "overdue", from: "2000-09-11" })).items.length, 0);
  assert.equal((await load({ alert: "overdue", state: "completed" })).items.length, 0);
  assert.equal((await load({ alert: "overdue", processStage: "project" })).items.length, 0);
  assert.equal((await load({ alert: "overdue", carryover: "yes" })).items.length, 0);
  assert.equal((await fixture(managerUser, { withAppointments: true, appointmentDueDate: "2099-09-10" }).load({ alert: "overdue" })).items.length, 0);
});
