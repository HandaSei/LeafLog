import { addDays, differenceInMinutes, eachDayOfInterval, format, parseISO } from "date-fns";
import type { Employee, TimeEntry } from "@shared/schema";
export { STALE_OPEN_SESSION_MINUTES } from "@shared/timekeeping";
import { STALE_OPEN_SESSION_MINUTES } from "@shared/timekeeping";

export type WorkdayStatus = "working" | "on-break" | "completed" | "incomplete";

export interface EmployeeWorkday {
  employee: Employee;
  entries: TimeEntry[];
  clockIn: Date | null;
  clockOut: Date | null;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  forcedUnpaidBreakMinutes: number;
  unpaidBreakMinutes: number;
  netWorkedMinutes: number;
  hasUnfinishedBreak: boolean;
  status: WorkdayStatus;
}

type ProcessingWorkday = Omit<EmployeeWorkday, "unpaidBreakMinutes" | "netWorkedMinutes"> & {
  lastClockIn: Date | null;
  lastBreakStart: Date | null;
  onBreak: boolean;
  currentBreakIsUnpaid: boolean;
  hasRealClockIn: boolean;
};

export type EntriesByDate = Map<string, Map<number, TimeEntry[]>>;
export type EntriesByEmployee = Map<number, TimeEntry[]>;
export type WorkdayGroup = { employeeId: number; sessions: EmployeeWorkday[] };
export type DayWorkdayGroup = { date: Date; groups: WorkdayGroup[]; totalMinutes: number };

export function getBreakPairs(entries: TimeEntry[], clockIn?: Date | null, clockOut?: Date | null): { start: TimeEntry; end: TimeEntry | null }[] {
  let filtered = [...entries]
    .filter(e => e.type === "break-start" || e.type === "break-end")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (clockIn || clockOut) {
    const clockOutBound = clockOut ? clockOut.getTime() + 60000 : null;
    filtered = filtered.filter(e => {
      const t = new Date(e.timestamp).getTime();
      if (clockIn && t < clockIn.getTime()) return false;
      if (clockOutBound && t > clockOutBound) return false;
      return true;
    });
  }
  const pairs: { start: TimeEntry; end: TimeEntry | null }[] = [];
  let pendingStart: TimeEntry | null = null;
  for (const e of filtered) {
    if (e.type === "break-start") {
      if (pendingStart) pairs.push({ start: pendingStart, end: null });
      pendingStart = e;
    } else if (e.type === "break-end" && pendingStart) {
      pairs.push({ start: pendingStart, end: e });
      pendingStart = null;
    }
  }
  if (pendingStart) pairs.push({ start: pendingStart, end: null });
  return pairs;
}

export function processEntriesForEmployee(
  emp: Employee,
  dayEntries: TimeEntry[],
  accountPaidBreakMinutes?: number | null,
  now = new Date()
): EmployeeWorkday[] {
  const paidBreakMinutes = emp.paidBreakMinutes != null ? emp.paidBreakMinutes : accountPaidBreakMinutes;
  const sorted = [...dayEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const workdays: EmployeeWorkday[] = [];
  let currentWorkday: ProcessingWorkday | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const ts = new Date(entry.timestamp);
    ts.setSeconds(0, 0);

    if (entry.type === "clock-in") {
      if (currentWorkday && !currentWorkday.clockOut) {
        currentWorkday.status = "incomplete";
        workdays.push(finalizeWorkday(emp, currentWorkday, paidBreakMinutes));
        currentWorkday = null;
      }

      currentWorkday = {
        employee: emp,
        entries: [],
        clockIn: ts,
        clockOut: null,
        totalWorkedMinutes: 0,
        totalBreakMinutes: 0,
        forcedUnpaidBreakMinutes: 0,
        hasUnfinishedBreak: false,
        status: "working",
        lastClockIn: ts,
        lastBreakStart: null,
        onBreak: false,
        currentBreakIsUnpaid: false,
        hasRealClockIn: true,
      };
    }

    if (!currentWorkday && entry.type !== "clock-in") {
      currentWorkday = {
        employee: emp,
        entries: [],
        clockIn: null,
        clockOut: null,
        totalWorkedMinutes: 0,
        totalBreakMinutes: 0,
        forcedUnpaidBreakMinutes: 0,
        hasUnfinishedBreak: false,
        status: "incomplete",
        lastClockIn: null,
        lastBreakStart: null,
        onBreak: false,
        currentBreakIsUnpaid: false,
        hasRealClockIn: false,
      };
    }

    if (!currentWorkday) continue;
    currentWorkday.entries.push(entry);

    switch (entry.type) {
      case "clock-out":
        currentWorkday.clockOut = ts;
        if (currentWorkday.lastClockIn) {
          currentWorkday.totalWorkedMinutes += differenceInMinutes(ts, currentWorkday.lastClockIn);
          currentWorkday.lastClockIn = null;
        } else if (currentWorkday.lastBreakStart) {
          let hasOutOfOrderBreakEnd = false;
          let outOfOrderBreakEndIdx = -1;
          for (let j = i + 1; j < sorted.length; j++) {
            if (sorted[j].type === "clock-in") break;
            if (sorted[j].type === "break-end") { hasOutOfOrderBreakEnd = true; outOfOrderBreakEndIdx = j; break; }
          }
          if (hasOutOfOrderBreakEnd) {
            currentWorkday.totalBreakMinutes += differenceInMinutes(ts, currentWorkday.lastBreakStart);
            currentWorkday.lastBreakStart = null;
            currentWorkday.onBreak = false;
            if (outOfOrderBreakEndIdx >= 0) {
              currentWorkday.entries.push(sorted[outOfOrderBreakEndIdx]);
            }
          } else {
            currentWorkday.hasUnfinishedBreak = true;
            currentWorkday.totalWorkedMinutes += differenceInMinutes(ts, currentWorkday.lastBreakStart);
            currentWorkday.lastBreakStart = null;
            currentWorkday.onBreak = false;
          }
        }
        currentWorkday.status = currentWorkday.hasRealClockIn ? "completed" : "incomplete";
        workdays.push(finalizeWorkday(emp, currentWorkday, paidBreakMinutes));
        currentWorkday = null;
        break;
      case "break-start":
        currentWorkday.lastBreakStart = ts;
        currentWorkday.onBreak = true;
        currentWorkday.status = "on-break";
        currentWorkday.currentBreakIsUnpaid = entry.isUnpaid ?? false;
        if (currentWorkday.lastClockIn) {
          currentWorkday.totalWorkedMinutes += differenceInMinutes(ts, currentWorkday.lastClockIn);
          currentWorkday.lastClockIn = null;
        }
        break;
      case "break-end":
        currentWorkday.onBreak = false;
        if (currentWorkday.hasRealClockIn) {
          currentWorkday.status = "working";
        }
        if (currentWorkday.lastBreakStart) {
          const breakDuration = differenceInMinutes(ts, currentWorkday.lastBreakStart);
          currentWorkday.totalBreakMinutes += breakDuration;
          if (currentWorkday.currentBreakIsUnpaid) {
            currentWorkday.forcedUnpaidBreakMinutes += breakDuration;
          }
          currentWorkday.lastBreakStart = null;
          currentWorkday.currentBreakIsUnpaid = false;
        }
        if (currentWorkday.hasRealClockIn) {
          currentWorkday.lastClockIn = ts;
        }
        break;
    }
  }

  if (currentWorkday) {
    if (!currentWorkday.hasRealClockIn) {
      currentWorkday.status = "incomplete";
    } else {
      const lastClockInRef = currentWorkday.lastClockIn || currentWorkday.clockIn;
      const minutesElapsed = lastClockInRef ? differenceInMinutes(now, lastClockInRef) : STALE_OPEN_SESSION_MINUTES + 1;

      if (minutesElapsed >= STALE_OPEN_SESSION_MINUTES) {
        currentWorkday.status = "incomplete";
      } else {
        if (currentWorkday.lastClockIn) {
          currentWorkday.totalWorkedMinutes += differenceInMinutes(now, currentWorkday.lastClockIn);
        }
        if (currentWorkday.lastBreakStart && currentWorkday.onBreak) {
          currentWorkday.totalBreakMinutes += differenceInMinutes(now, currentWorkday.lastBreakStart);
        }
      }
    }
    workdays.push(finalizeWorkday(emp, currentWorkday, paidBreakMinutes));
  }

  if (workdays.length === 0 && sorted.length > 0) {
    return [{
      employee: emp,
      entries: sorted,
      clockIn: null,
      clockOut: null,
      totalWorkedMinutes: 0,
      totalBreakMinutes: 0,
      forcedUnpaidBreakMinutes: 0,
      unpaidBreakMinutes: 0,
      netWorkedMinutes: 0,
      hasUnfinishedBreak: false,
      status: "incomplete",
    }];
  }
  return workdays;
}

function finalizeWorkday(emp: Employee, wd: ProcessingWorkday, paidBreakMinutes?: number | null): EmployeeWorkday {
  const forcedUnpaid = wd.forcedUnpaidBreakMinutes ?? 0;
  const regularBreakMinutes = (wd.totalBreakMinutes ?? 0) - forcedUnpaid;
  const policyUnpaid = (paidBreakMinutes != null && paidBreakMinutes >= 0)
    ? Math.max(0, regularBreakMinutes - paidBreakMinutes)
    : 0;
  const unpaidBreakMinutes = forcedUnpaid + policyUnpaid;
  const paidBreakActual = (wd.totalBreakMinutes ?? 0) - unpaidBreakMinutes;
  const netWorkedMinutes = Math.max(0, (wd.totalWorkedMinutes ?? 0) + paidBreakActual);

  return {
    employee: emp,
    entries: wd.entries,
    clockIn: wd.clockIn,
    clockOut: wd.clockOut,
    totalWorkedMinutes: wd.totalWorkedMinutes,
    forcedUnpaidBreakMinutes: forcedUnpaid,
    totalBreakMinutes: wd.totalBreakMinutes,
    unpaidBreakMinutes,
    netWorkedMinutes,
    hasUnfinishedBreak: wd.hasUnfinishedBreak ?? false,
    status: wd.status,
  };
}

export function normalizeEntryDates(entries: TimeEntry[]): TimeEntry[] {
  const byEmployee = new Map<number, TimeEntry[]>();
  entries.forEach(e => {
    const list = byEmployee.get(e.employeeId) || [];
    list.push(e);
    byEmployee.set(e.employeeId, list);
  });

  const result: TimeEntry[] = [];

  byEmployee.forEach((empEntries) => {
    const sorted = [...empEntries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let currentSessionDate: string | null = null;

    for (const entry of sorted) {
      if (entry.type === "shift-reopened") {
        result.push(entry);
        continue;
      }

      const entryDate = typeof entry.date === "string"
        ? entry.date.substring(0, 10)
        : format(new Date(entry.date), "yyyy-MM-dd");

      if (entry.type === "clock-in") {
        currentSessionDate = entryDate;
        result.push(entry);
      } else if (entry.type === "clock-out") {
        if (currentSessionDate && entryDate !== currentSessionDate) {
          result.push({ ...entry, date: currentSessionDate });
        } else {
          result.push(entry);
        }
        currentSessionDate = null;
      } else {
        if (currentSessionDate && entryDate !== currentSessionDate) {
          result.push({ ...entry, date: currentSessionDate });
        } else {
          result.push(entry);
        }
      }
    }
  });

  return result;
}

export function buildEmployeeMap(employees: Employee[]): Map<number, Employee> {
  const map = new Map<number, Employee>();
  employees.forEach(e => map.set(e.id, e));
  return map;
}

export function buildEntryIndexByDate(entries: TimeEntry[]): EntriesByDate {
  const index: EntriesByDate = new Map();
  entries.forEach(entry => {
    if (entry.type === "shift-reopened") return;
    const entryDateStr = typeof entry.date === "string" ? entry.date.substring(0, 10) : format(new Date(entry.date), "yyyy-MM-dd");
    let byEmployee = index.get(entryDateStr);
    if (!byEmployee) {
      byEmployee = new Map();
      index.set(entryDateStr, byEmployee);
    }
    const list = byEmployee.get(entry.employeeId) || [];
    list.push(entry);
    byEmployee.set(entry.employeeId, list);
  });
  return index;
}

export function buildEntryIndexByEmployee(entries: TimeEntry[]): EntriesByEmployee {
  const index: EntriesByEmployee = new Map();
  entries.forEach(entry => {
    const list = index.get(entry.employeeId) || [];
    list.push(entry);
    index.set(entry.employeeId, list);
  });
  return index;
}

export function groupWorkdaysByEmployee(workdays: EmployeeWorkday[]): WorkdayGroup[] {
  const grouped = new Map<number, EmployeeWorkday[]>();
  workdays.forEach(wd => {
    const list = grouped.get(wd.employee.id) || [];
    list.push(wd);
    grouped.set(wd.employee.id, list);
  });
  return Array.from(grouped.entries()).map(([employeeId, sessions]) => ({ employeeId, sessions }));
}

function buildWorkdaysFromGroups(
  grouped: Map<number, TimeEntry[]> | undefined,
  empMap: Map<number, Employee>,
  selectedRole: string,
  employeeSearchLower: string,
  paidBreakMinutes?: number | null
): EmployeeWorkday[] {
  if (!grouped) return [];

  const workdays: EmployeeWorkday[] = [];
  grouped.forEach((dayEntries, employeeId) => {
    const emp = empMap.get(employeeId);
    if (!emp) return;
    if (selectedRole !== "all" && emp.role !== selectedRole) return;
    if (employeeSearchLower && !emp.name.toLowerCase().includes(employeeSearchLower)) return;
    const processed = processEntriesForEmployee(emp, dayEntries, paidBreakMinutes);
    workdays.push(...processed);
  });

  workdays.sort((a, b) => {
    if (a.clockIn && b.clockIn) return a.clockIn.getTime() - b.clockIn.getTime();
    if (a.clockIn) return -1;
    if (b.clockIn) return 1;
    return 0;
  });

  return workdays;
}

export function getRelevantSessions(sessions: EmployeeWorkday[], dateStr: string) {
  const prevDay = format(addDays(parseISO(dateStr), -1), "yyyy-MM-dd");
  const nextDay = format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd");
  return sessions.filter(session => {
    if (!session.clockIn) return false;
    const sessionDate = format(session.clockIn, "yyyy-MM-dd");
    return sessionDate === dateStr || sessionDate === prevDay || sessionDate === nextDay;
  });
}

export function buildWorkdaysForDate(
  entries: TimeEntry[],
  employees: Employee[],
  date: Date,
  selectedRole: string,
  employeeSearch: string,
  paidBreakMinutes?: number | null
): EmployeeWorkday[] {
  const dateStr = format(date, "yyyy-MM-dd");
  const empMap = buildEmployeeMap(employees);
  const employeeSearchLower = employeeSearch.trim().toLowerCase();
  const entryIndex = buildEntryIndexByDate(entries);
  return buildWorkdaysFromGroups(entryIndex.get(dateStr), empMap, selectedRole, employeeSearchLower, paidBreakMinutes);
}

export function buildWorkdaysForIndexedDateWithMap(
  entryIndex: EntriesByDate,
  empMap: Map<number, Employee>,
  date: Date,
  selectedRole: string,
  employeeSearchLower: string,
  paidBreakMinutes?: number | null
): EmployeeWorkday[] {
  const dateStr = format(date, "yyyy-MM-dd");
  return buildWorkdaysFromGroups(entryIndex.get(dateStr), empMap, selectedRole, employeeSearchLower, paidBreakMinutes);
}

export function buildWorkdaysForIndexedDate(
  entryIndex: EntriesByDate,
  employees: Employee[],
  date: Date,
  selectedRole: string,
  employeeSearch: string,
  paidBreakMinutes?: number | null
): EmployeeWorkday[] {
  const empMap = buildEmployeeMap(employees);
  return buildWorkdaysForIndexedDateWithMap(entryIndex, empMap, date, selectedRole, employeeSearch.trim().toLowerCase(), paidBreakMinutes);
}

export function buildWorkdaysForRange(
  entries: TimeEntry[],
  employees: Employee[],
  startDate: Date,
  endDate: Date,
  selectedRole: string,
  employeeSearch: string,
  targetEmployeeIds: number[] | null = null,
  paidBreakMinutes?: number | null
): { date: Date; workdays: EmployeeWorkday[] }[] {
  const entryIndex = buildEntryIndexByDate(entries);
  return buildWorkdaysForIndexedRange(entryIndex, employees, startDate, endDate, selectedRole, employeeSearch, targetEmployeeIds, paidBreakMinutes);
}

export function buildWorkdaysForIndexedRange(
  entryIndex: EntriesByDate,
  employees: Employee[],
  startDate: Date,
  endDate: Date,
  selectedRole: string,
  employeeSearch: string,
  targetEmployeeIds: number[] | null = null,
  paidBreakMinutes?: number | null
): { date: Date; workdays: EmployeeWorkday[] }[] {
  const empMap = buildEmployeeMap(employees);
  return buildWorkdaysForIndexedRangeWithMap(entryIndex, empMap, startDate, endDate, selectedRole, employeeSearch.trim().toLowerCase(), targetEmployeeIds, paidBreakMinutes);
}

export function buildWorkdaysForIndexedRangeWithMap(
  entryIndex: EntriesByDate,
  empMap: Map<number, Employee>,
  startDate: Date,
  endDate: Date,
  selectedRole: string,
  employeeSearchLower: string,
  targetEmployeeIds: number[] | null = null,
  paidBreakMinutes?: number | null
): { date: Date; workdays: EmployeeWorkday[] }[] {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const targetSet = targetEmployeeIds && targetEmployeeIds.length > 0 ? new Set(targetEmployeeIds) : null;
  return days
    .map(day => {
      const dateStr = format(day, "yyyy-MM-dd");
      let dayWorkdays = buildWorkdaysFromGroups(entryIndex.get(dateStr), empMap, selectedRole, employeeSearchLower, paidBreakMinutes);
      if (targetSet) {
        dayWorkdays = dayWorkdays.filter(wd => targetSet.has(wd.employee.id));
      }
      return { date: day, workdays: dayWorkdays };
    })
    .filter(d => d.workdays.length > 0);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function formatHoursDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function toEntryDateString(value: string | Date): string {
  return value instanceof Date ? format(value, "yyyy-MM-dd") : value.substring(0, 10);
}

export function toEntryTimestampIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function shiftMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}
