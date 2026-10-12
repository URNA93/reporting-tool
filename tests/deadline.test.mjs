import assert from "node:assert/strict";
import test from "node:test";
import { daysOverdue, isOverdue, nextDueSort, overdueLabel, sortByDue, todayInPrague } from "../lib/deadline.ts";

const NOW = new Date("2026-10-11T10:00:00Z"); // 11. 10. 2026 v Praze

test("today is evaluated in the Prague time zone", () => {
  assert.equal(todayInPrague(new Date("2026-10-10T22:30:00Z")), "2026-10-11");
  assert.equal(todayInPrague(new Date("2026-10-10T21:30:00Z")), "2026-10-10");
});

test("open item with a past deadline is overdue", () => {
  assert.equal(daysOverdue({ dueDate: "2026-10-08", status: "active" }, NOW), 3);
  assert.equal(daysOverdue({ dueDate: "2026-10-10", status: "scheduled" }, NOW), 1);
});

test("deadline today or in the future is not overdue", () => {
  assert.equal(isOverdue({ dueDate: "2026-10-11", status: "active" }, NOW), false);
  assert.equal(isOverdue({ dueDate: "2026-10-14", status: "active" }, NOW), false);
});

test("finished, cancelled and undated items are never overdue", () => {
  for (const status of ["completed", "done", "cancelled"]) {
    assert.equal(isOverdue({ dueDate: "2026-09-01", status }, NOW), false);
  }
  assert.equal(isOverdue({ dueDate: null, status: "active" }, NOW), false);
});

test("overdue label uses correct Czech plural", () => {
  assert.equal(overdueLabel(1), "Po termínu · 1 den");
  assert.equal(overdueLabel(3), "Po termínu · 3 dny");
  assert.equal(overdueLabel(5), "Po termínu · 5 dní");
  assert.equal(overdueLabel(21), "Po termínu · 21 dní");
});

const due = (id, dueDate, dueTime = null) => ({ id, dueDate, dueTime });
const sample = [due("c", "2026-10-20", "14:00"), due("none-1", null), due("a", "2026-10-12"), due("b", "2026-10-20", "09:00"), due("none-2", null), due("a2", "2026-10-12")];

test("sorting by due date goes by date, then time, and keeps undated items last in both directions", () => {
  assert.deepEqual(sortByDue(sample, "asc").map((item) => item.id), ["a", "a2", "b", "c", "none-1", "none-2"]);
  assert.deepEqual(sortByDue(sample, "desc").map((item) => item.id), ["c", "b", "a", "a2", "none-1", "none-2"]);
});

test("sorting is stable, does not mutate its input and 'none' keeps the original order", () => {
  const before = sample.map((item) => item.id);
  sortByDue(sample, "asc");
  assert.deepEqual(sample.map((item) => item.id), before);
  assert.equal(sortByDue(sample, "none"), sample);
});

test("clicking the Termín header cycles ascending, descending, original", () => {
  assert.equal(nextDueSort("none"), "asc");
  assert.equal(nextDueSort("asc"), "desc");
  assert.equal(nextDueSort("desc"), "none");
});
