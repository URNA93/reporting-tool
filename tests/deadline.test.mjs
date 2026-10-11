import assert from "node:assert/strict";
import test from "node:test";
import { daysOverdue, isOverdue, overdueLabel, todayInPrague } from "../lib/deadline.ts";

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
