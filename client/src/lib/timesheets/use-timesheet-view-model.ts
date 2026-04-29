import { useMemo } from "react";
import { format, isSameDay, startOfWeek } from "date-fns";
import type { Employee, TimeEntry } from "@shared/schema";
import { isActiveUnarchivedEmployee } from "@/lib/employees";
import { calculateDayPay, hasPayConfig } from "@/lib/pay-utils";
import {
  buildEmployeeMap,
  buildEntryIndexByDate,
  buildEntryIndexByEmployee,
  buildWorkdaysForIndexedDateWithMap,
  buildWorkdaysForIndexedRangeWithMap,
  groupWorkdaysByEmployee,
  normalizeEntryDates,
  type DayWorkdayGroup,
  type EmployeeWorkday,
} from "@/lib/timesheets/session-engine";

export type TimesheetViewMode = "week" | "month";

type TimesheetViewModelInput = {
  entries: TimeEntry[];
  employees: Employee[];
  viewMode: TimesheetViewMode;
  weekDays: Date[];
  selectedDay: Date;
  selectedMonth: Date;
  monthEnd: Date;
  selectedRole: string;
  employeeSearch: string;
  paidBreakMinutes: number | null;
  selectedWorkday: EmployeeWorkday | null;
  viewingDate: Date | null;
};

export function useTimesheetViewModel({
  entries,
  employees,
  viewMode,
  weekDays,
  selectedDay,
  selectedMonth,
  monthEnd,
  selectedRole,
  employeeSearch,
  paidBreakMinutes,
  selectedWorkday,
  viewingDate,
}: TimesheetViewModelInput) {
  const normalizedEntries = useMemo(() => normalizeEntryDates(entries), [entries]);
  const indexedEntries = useMemo(() => buildEntryIndexByDate(normalizedEntries), [normalizedEntries]);
  const visibleEmployees = useMemo(
    () => employees.filter(isActiveUnarchivedEmployee),
    [employees]
  );
  const employeeMap = useMemo(() => buildEmployeeMap(visibleEmployees), [visibleEmployees]);
  const employeeSearchLower = useMemo(() => employeeSearch.trim().toLowerCase(), [employeeSearch]);
  const employeeEntriesById = useMemo(() => buildEntryIndexByEmployee(normalizedEntries), [normalizedEntries]);
  const rawEmployeeEntriesById = useMemo(() => buildEntryIndexByEmployee(entries), [entries]);

  const weekWorkdaysByDay = useMemo(() => {
    if (viewMode !== "week") return [];
    return weekDays.map(day => ({
      date: day,
      workdays: buildWorkdaysForIndexedDateWithMap(
        indexedEntries,
        employeeMap,
        day,
        selectedRole,
        employeeSearchLower,
        paidBreakMinutes
      ),
    }));
  }, [viewMode, weekDays, indexedEntries, employeeMap, selectedRole, employeeSearchLower, paidBreakMinutes]);

  const workdays = useMemo(() => {
    if (viewMode !== "week") return [];
    return weekWorkdaysByDay.find(day => isSameDay(day.date, selectedDay))?.workdays || [];
  }, [viewMode, weekWorkdaysByDay, selectedDay]);

  const monthWorkdays = useMemo(() => {
    if (viewMode !== "month") return [];
    return buildWorkdaysForIndexedRangeWithMap(
      indexedEntries,
      employeeMap,
      selectedMonth,
      monthEnd,
      selectedRole,
      employeeSearchLower,
      null,
      paidBreakMinutes
    );
  }, [viewMode, indexedEntries, employeeMap, selectedMonth, monthEnd, selectedRole, employeeSearchLower, paidBreakMinutes]);

  const viewingWorkday = useMemo(() => {
    if (!selectedWorkday) return null;
    const dateToUse = viewingDate || selectedDay;
    const dayWorkdays = buildWorkdaysForIndexedDateWithMap(
      indexedEntries,
      employeeMap,
      dateToUse,
      selectedRole,
      employeeSearchLower,
      paidBreakMinutes
    );
    const selectedEntryIds = new Set(selectedWorkday.entries.map(e => e.id));
    return dayWorkdays.find(w =>
      w.employee.id === selectedWorkday.employee.id &&
      w.entries.some(e => selectedEntryIds.has(e.id))
    ) || dayWorkdays.find(w =>
      w.employee.id === selectedWorkday.employee.id &&
      w.clockIn?.getTime() === selectedWorkday.clockIn?.getTime()
    ) || null;
  }, [selectedWorkday, viewingDate, indexedEntries, employeeMap, selectedDay, selectedRole, employeeSearchLower, paidBreakMinutes]);

  const weekWorkdayGroups = useMemo(() => groupWorkdaysByEmployee(workdays), [workdays]);
  const monthWorkdayGroups = useMemo<DayWorkdayGroup[]>(() => {
    if (viewMode !== "month") return [];
    return monthWorkdays.map(({ date, workdays: dayWorkdays }) => ({
      date,
      groups: groupWorkdaysByEmployee(dayWorkdays),
      totalMinutes: dayWorkdays.reduce((sum, workday) => sum + workday.netWorkedMinutes, 0),
    }));
  }, [viewMode, monthWorkdays]);

  const hasVisibleWorkdays = viewMode === "week" ? workdays.length > 0 : monthWorkdays.length > 0;

  const totalHours = useMemo(() => {
    if (viewMode === "week") return workdays.reduce((sum, workday) => sum + workday.netWorkedMinutes, 0);
    return monthWorkdayGroups.reduce((sum, day) => sum + day.totalMinutes, 0);
  }, [viewMode, workdays, monthWorkdayGroups]);

  const totalPay = useMemo(() => {
    const anyHasPay = visibleEmployees.some(employee => hasPayConfig(employee));
    if (!anyHasPay) return null;

    const source = viewMode === "week" ? weekWorkdaysByDay : monthWorkdays;
    const weeklyHoursMap = new Map<string, number>();
    let total = 0;

    source.forEach(({ date, workdays: dayWorkdays }) => {
      const dateStr = format(date, "yyyy-MM-dd");
      const weekKey = format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");

      dayWorkdays.forEach(workday => {
        if (!hasPayConfig(workday.employee)) return;
        const empWeekKey = `${workday.employee.id}:${weekKey}`;
        const weekHours = weeklyHoursMap.get(empWeekKey) || 0;
        const dayHours = workday.netWorkedMinutes / 60;
        total += calculateDayPay(workday.employee, dateStr, dayHours, weekHours);
        weeklyHoursMap.set(empWeekKey, weekHours + dayHours);
      });
    });

    return total;
  }, [viewMode, weekWorkdaysByDay, monthWorkdays, visibleEmployees]);

  return {
    normalizedEntries,
    employeeEntriesById,
    rawEmployeeEntriesById,
    visibleEmployees,
    weekWorkdaysByDay,
    workdays,
    monthWorkdays,
    viewingWorkday,
    weekWorkdayGroups,
    monthWorkdayGroups,
    hasVisibleWorkdays,
    totalHours,
    totalPay,
  };
}
