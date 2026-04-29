import { differenceInMinutes, parseISO } from "date-fns";
import type { Employee, Shift, TimeEntry } from "@shared/schema";
import {
  getBreakPairs,
  processEntriesForEmployee,
  type EmployeeWorkday,
} from "@/lib/timesheets/session-engine";

export interface BreakInfo {
  onBreak: boolean;
  currentBreakMinutes: number;
  totalBreakMinutes: number;
  breakCount: number;
  hasUnfinishedBreak: boolean;
  unpaidBreakMinutes: number;
}

export interface NoBreakWarning {
  workedMinutes: number;
}

export type ClockStatus =
  | { kind: "on-time"; clockInTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "clocked-late"; clockInTime: string; minutesLate: number; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "not-yet"; minutesUntil: number }
  | { kind: "late"; minutesLate: number }
  | { kind: "very-late"; minutesLate: number }
  | { kind: "clocked-out"; clockInTime: string; clockOutTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "waiting" }
  | { kind: "working-no-schedule"; clockInTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "done-no-schedule"; clockInTime: string; clockOutTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null };

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function getActiveBreakStart(workday: EmployeeWorkday): Date | null {
  if (workday.status !== "on-break") return null;
  const pairs = getBreakPairs(workday.entries, workday.clockIn, workday.clockOut);
  const activePair = [...pairs].reverse().find((pair) => !pair.end);
  return activePair ? new Date(activePair.start.timestamp) : null;
}

export function getDashboardBreakInfo(workday: EmployeeWorkday, now: Date): BreakInfo {
  const activeBreakStart = getActiveBreakStart(workday);
  const onBreak = activeBreakStart !== null;
  const breakPairs = getBreakPairs(workday.entries, workday.clockIn, workday.clockOut);
  const completedBreakCount = breakPairs.filter((pair) => pair.end).length;

  return {
    onBreak,
    currentBreakMinutes: activeBreakStart ? differenceInMinutes(now, activeBreakStart) : 0,
    totalBreakMinutes: workday.totalBreakMinutes,
    breakCount: completedBreakCount + (onBreak ? 1 : 0),
    hasUnfinishedBreak: workday.hasUnfinishedBreak,
    unpaidBreakMinutes: workday.unpaidBreakMinutes,
  };
}

function getNoBreakWarning(workday: EmployeeWorkday, endTime: Date, breakInfo: BreakInfo): NoBreakWarning | null {
  if (breakInfo.breakCount > 0 || breakInfo.hasUnfinishedBreak || !workday.clockIn) return null;

  const workedMinutes = differenceInMinutes(endTime, workday.clockIn);
  if (workedMinutes >= 375) {
    return { workedMinutes };
  }
  return null;
}

function getProcessedWorkdays(
  employee: Employee,
  entries: TimeEntry[],
  now: Date,
  paidBreakMinutes?: number | null,
): EmployeeWorkday[] {
  return processEntriesForEmployee(employee, entries, paidBreakMinutes, now)
    .filter((workday) => workday.clockIn)
    .sort((a, b) => (a.clockIn?.getTime() ?? 0) - (b.clockIn?.getTime() ?? 0));
}

function getShiftStart(shift: Shift): Date {
  return parseISO(`${typeof shift.date === "string" ? shift.date : toIso(shift.date).substring(0, 10)}T${shift.startTime}`);
}

function buildScheduledFallbackStatus(shift: Shift, now: Date): ClockStatus {
  const shiftStart = getShiftStart(shift);

  if (now < shiftStart) {
    const minutesUntil = differenceInMinutes(shiftStart, now);
    return minutesUntil <= 60
      ? { kind: "not-yet", minutesUntil }
      : { kind: "waiting" };
  }

  const minutesLate = differenceInMinutes(now, shiftStart);
  return minutesLate >= 60
    ? { kind: "very-late", minutesLate }
    : { kind: "late", minutesLate };
}

export function getClockStatusForScheduled(
  shift: Shift,
  employee: Employee,
  entries: TimeEntry[],
  now: Date,
  paidBreakMinutes?: number | null,
): ClockStatus[] {
  const shiftStart = getShiftStart(shift);
  const statuses: ClockStatus[] = [];

  for (const workday of getProcessedWorkdays(employee, entries, now, paidBreakMinutes)) {
    if (!workday.clockIn) continue;
    const breakInfo = getDashboardBreakInfo(workday, now);

    if (workday.clockOut) {
      statuses.push({
        kind: "clocked-out",
        clockInTime: toIso(workday.clockIn),
        clockOutTime: toIso(workday.clockOut),
        breakInfo,
        noBreakWarning: getNoBreakWarning(workday, workday.clockOut, breakInfo),
      });
      continue;
    }

    if (workday.status === "working" || workday.status === "on-break") {
      const minutesLate = differenceInMinutes(workday.clockIn, shiftStart);
      const activeStatus: ClockStatus = minutesLate <= 5
        ? {
            kind: "on-time",
            clockInTime: toIso(workday.clockIn),
            breakInfo,
            noBreakWarning: getNoBreakWarning(workday, now, breakInfo),
          }
        : {
            kind: "clocked-late",
            clockInTime: toIso(workday.clockIn),
            minutesLate,
            breakInfo,
            noBreakWarning: getNoBreakWarning(workday, now, breakInfo),
          };
      statuses.push(activeStatus);
    }
  }

  if (statuses.length === 0) {
    statuses.push(buildScheduledFallbackStatus(shift, now));
  }

  return statuses;
}

export function getClockStatusForUnscheduled(
  employee: Employee,
  entries: TimeEntry[],
  now: Date,
  paidBreakMinutes?: number | null,
): ClockStatus[] {
  const statuses: ClockStatus[] = [];

  for (const workday of getProcessedWorkdays(employee, entries, now, paidBreakMinutes)) {
    if (!workday.clockIn) continue;
    const breakInfo = getDashboardBreakInfo(workday, now);

    if (workday.clockOut) {
      statuses.push({
        kind: "done-no-schedule",
        clockInTime: toIso(workday.clockIn),
        clockOutTime: toIso(workday.clockOut),
        breakInfo,
        noBreakWarning: getNoBreakWarning(workday, workday.clockOut, breakInfo),
      });
      continue;
    }

    if (workday.status === "working" || workday.status === "on-break") {
      statuses.push({
        kind: "working-no-schedule",
        clockInTime: toIso(workday.clockIn),
        breakInfo,
        noBreakWarning: getNoBreakWarning(workday, now, breakInfo),
      });
    }
  }

  return statuses;
}
