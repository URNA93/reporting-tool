import assert from "node:assert/strict";
import test from "node:test";
import {
  currentReportingPeriod,
  firstTuesdayOfMonth,
  reportingPeriodForClosingMonth,
  reportingPeriodsAround,
} from "../lib/reporting-period.ts";
import {
  MANAGER_POSITION_CODES,
  SELF_REGISTRATION_POSITION_CODES,
  canManageReportsFor,
  isManagerPosition,
} from "../lib/positions.ts";

test("first Tuesday is calculated without a date table", () => {
  assert.equal(firstTuesdayOfMonth(2026, 9), "2026-09-01");
  assert.equal(firstTuesdayOfMonth(2026, 10), "2026-10-06");
  assert.equal(firstTuesdayOfMonth(2027, 1), "2027-01-05");
});

test("current period changes only after the first Tuesday in Prague", () => {
  assert.deepEqual(currentReportingPeriod(new Date("2026-09-01T21:59:00Z")), [
    "2026-08-05",
    "2026-09-01",
  ]);
  assert.deepEqual(currentReportingPeriod(new Date("2026-09-01T22:01:00Z")), [
    "2026-09-02",
    "2026-10-06",
  ]);
});

test("period calculation crosses a year boundary", () => {
  assert.deepEqual(reportingPeriodForClosingMonth(2027, 1), [
    "2026-12-02",
    "2027-01-05",
  ]);
});

test("period picker contains previous, current and future periods", () => {
  const periods = reportingPeriodsAround(new Date("2026-09-02T10:00:00Z"), 2, 2);
  assert.equal(periods.length, 5);
  assert.equal(periods.filter((period) => period.relation === "current").length, 1);
  assert.equal(periods.find((period) => period.relation === "current")?.end, "2026-10-06");
  assert.equal(periods[0].relation, "future");
  assert.equal(periods.at(-1)?.relation, "previous");
});

test("self-registration excludes TM and higher positions", () => {
  assert.deepEqual(SELF_REGISTRATION_POSITION_CODES, ["T", "FC", "FS", "HFC"]);
  assert.deepEqual(MANAGER_POSITION_CODES, ["TM", "AM", "AD", "RD", "GD", "P"]);
  assert.equal(isManagerPosition("TM"), true);
  assert.equal(isManagerPosition("P"), true);
  assert.equal(isManagerPosition("HFC"), false);
  assert.equal(isManagerPosition("GA1"), false);
});

test("report management is controlled by role, independently of position", () => {
  assert.equal(canManageReportsFor("admin", "T"), true);
  assert.equal(canManageReportsFor("manager", "TM"), true);
  assert.equal(canManageReportsFor("manager", "HFC"), true);
  assert.equal(canManageReportsFor("user", "TM"), false);
  assert.equal(canManageReportsFor("user", "P"), false);
});
