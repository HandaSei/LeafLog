import assert from "node:assert/strict";
import {
  getClockStatusForScheduled,
  getClockStatusForUnscheduled,
} from "../client/src/lib/dashboard/clock-status";
import { STALE_OPEN_SESSION_MINUTES } from "../client/src/lib/timesheets/session-engine";
import type { Employee, Shift, TimeEntry } from "../shared/schema";

const employee: Employee = {
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

const shift: Shift = {
  id: 1,
  employeeId: 1,
  date: "2026-04-27",
  startTime: "09:00",
  endTime: "17:00",
  status: "scheduled",
  notes: null,
  color: null,
  role: "Supervisor",
};

let nextId = 1;

function entry(type: string, timestamp: string, patch: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: nextId++,
    employeeId: 1,
    type,
    timestamp: new Date(timestamp),
    date: timestamp.slice(0, 10),
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

run("builds scheduled completed sessions from the shared session engine", () => {
  const statuses = getClockStatusForScheduled(
    shift,
    employee,
    [
      entry("clock-in", "2026-04-27T09:00:00"),
      entry("break-start", "2026-04-27T12:00:00"),
      entry("break-end", "2026-04-27T12:30:00"),
      entry("clock-out", "2026-04-27T17:00:00"),
    ],
    new Date("2026-04-27T17:00:00"),
    25,
  );

  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].kind, "clocked-out");
  if (statuses[0].kind !== "clocked-out") return;
  assert.equal(statuses[0].breakInfo.totalBreakMinutes, 30);
  assert.equal(statuses[0].breakInfo.unpaidBreakMinutes, 5);
});

run("keeps active scheduled workers on-time when clock-in is within grace period", () => {
  const statuses = getClockStatusForScheduled(
    shift,
    employee,
    [entry("clock-in", "2026-04-27T09:04:00")],
    new Date("2026-04-27T10:00:00"),
    null,
  );

  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].kind, "on-time");
});

run("reports active unscheduled workers without schedule status", () => {
  const statuses = getClockStatusForUnscheduled(
    employee,
    [entry("clock-in", "2026-04-27T11:00:00")],
    new Date("2026-04-27T12:00:00"),
    null,
  );

  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].kind, "working-no-schedule");
});

run("does not show stale open sessions as active dashboard work", () => {
  const now = new Date("2026-04-28T12:00:00.000Z");
  const staleStart = new Date(now.getTime() - (STALE_OPEN_SESSION_MINUTES + 10) * 60 * 1000).toISOString();
  const statuses = getClockStatusForUnscheduled(
    employee,
    [entry("clock-in", staleStart)],
    now,
    null,
  );

  assert.equal(statuses.length, 0);
});

run("keeps no-break warnings for long completed sessions", () => {
  const statuses = getClockStatusForScheduled(
    shift,
    employee,
    [
      entry("clock-in", "2026-04-27T09:00:00"),
      entry("clock-out", "2026-04-27T16:00:00"),
    ],
    new Date("2026-04-27T16:00:00"),
    null,
  );

  assert.equal(statuses[0].kind, "clocked-out");
  if (statuses[0].kind !== "clocked-out") return;
  assert.equal(statuses[0].noBreakWarning?.workedMinutes, 420);
});
