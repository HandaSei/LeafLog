import assert from "node:assert/strict";
import {
  buildEntryIndexByDate,
  buildEmployeeMap,
  buildWorkdaysForIndexedDateWithMap,
  normalizeEntryDates,
  processEntriesForEmployee,
  STALE_OPEN_SESSION_MINUTES,
} from "../client/src/lib/timesheets/session-engine";
import type { Employee, TimeEntry } from "../shared/schema";

const baseEmployee: Employee = {
  id: 1,
  name: "Lucian",
  email: null,
  phone: null,
  role: "Supervisor",
  department: null,
  color: "#aa0000",
  status: "active",
  avatarInitials: null,
  accountId: null,
  ownerAccountId: 1,
  accessCode: "1234",
  paidBreakMinutes: null,
  maxBreakMinutes: null,
  hourlyRate: null,
  tierEnabled: false,
  tierHoursThreshold: null,
  tierOvertimeRate: null,
  specialDayEnabled: false,
  specialDayOfWeek: null,
  specialDayRate: null,
  customPayDays: null,
  tierThresholdOnly: false,
  hiddenFromSteepin: false,
};

let nextId = 1;

function entry(type: string, timestamp: string, date?: string, patch: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: nextId++,
    employeeId: 1,
    type,
    timestamp: new Date(timestamp),
    date: date ?? timestamp.slice(0, 10),
    role: null,
    notes: null,
    isUnpaid: false,
    source: "manager",
    ...patch,
  };
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

run("normalizes overnight clock-out entries back to the clock-in session date", () => {
  const entries = normalizeEntryDates([
    entry("clock-in", "2026-04-27T22:00:00.000Z", "2026-04-27"),
    entry("break-start", "2026-04-27T23:30:00.000Z", "2026-04-27"),
    entry("break-end", "2026-04-27T23:45:00.000Z", "2026-04-27"),
    entry("clock-out", "2026-04-28T02:00:00.000Z", "2026-04-28"),
  ]);

  assert.equal(entries[3].date, "2026-04-27");

  const index = buildEntryIndexByDate(entries);
  const workdays = buildWorkdaysForIndexedDateWithMap(
    index,
    buildEmployeeMap([baseEmployee]),
    new Date("2026-04-27T00:00:00.000Z"),
    "all",
    "",
    25
  );

  assert.equal(workdays.length, 1);
  assert.equal(workdays[0].status, "completed");
  assert.equal(workdays[0].totalBreakMinutes, 15);
  assert.equal(workdays[0].netWorkedMinutes, 240);
});

run("deducts only break time above the paid break allowance", () => {
  const workdays = processEntriesForEmployee(
    baseEmployee,
    [
      entry("clock-in", "2026-04-27T17:00:00.000Z"),
      entry("break-start", "2026-04-27T20:00:00.000Z"),
      entry("break-end", "2026-04-27T20:37:00.000Z"),
      entry("clock-out", "2026-04-27T23:00:00.000Z"),
    ],
    25,
    new Date("2026-04-27T23:00:00.000Z")
  );

  assert.equal(workdays.length, 1);
  assert.equal(workdays[0].status, "completed");
  assert.equal(workdays[0].totalBreakMinutes, 37);
  assert.equal(workdays[0].unpaidBreakMinutes, 12);
  assert.equal(workdays[0].netWorkedMinutes, 348);
});

run("keeps recent open sessions active", () => {
  const now = new Date("2026-04-28T12:00:00.000Z");
  const workdays = processEntriesForEmployee(
    baseEmployee,
    [entry("clock-in", "2026-04-28T10:00:00.000Z")],
    null,
    now
  );

  assert.equal(workdays.length, 1);
  assert.equal(workdays[0].status, "working");
  assert.equal(workdays[0].netWorkedMinutes, 120);
});

run("marks stale open sessions incomplete instead of active", () => {
  const now = new Date("2026-04-28T12:00:00.000Z");
  const staleStart = new Date(now.getTime() - (STALE_OPEN_SESSION_MINUTES + 30) * 60 * 1000).toISOString();
  const workdays = processEntriesForEmployee(
    baseEmployee,
    [entry("clock-in", staleStart)],
    null,
    now
  );

  assert.equal(workdays.length, 1);
  assert.equal(workdays[0].status, "incomplete");
  assert.equal(workdays[0].clockOut, null);
});

run("splits a newer clock-in into a new session instead of merging with the older one", () => {
  const now = new Date("2026-04-28T15:00:00.000Z");
  const workdays = processEntriesForEmployee(
    baseEmployee,
    [
      entry("clock-in", "2026-04-28T09:00:00.000Z"),
      entry("clock-in", "2026-04-28T13:00:00.000Z"),
    ],
    null,
    now
  );

  assert.equal(workdays.length, 2);
  assert.equal(workdays[0].status, "incomplete");
  assert.equal(workdays[1].status, "working");
  assert.equal(workdays[1].netWorkedMinutes, 120);
});
