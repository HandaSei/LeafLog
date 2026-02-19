import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, differenceInMinutes, parseISO } from "date-fns";
import type { Shift, Employee } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, ArrowRight, CalendarDays, CheckCircle2, Clock, AlertTriangle, XCircle, Coffee, AlertCircle } from "lucide-react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { formatTime } from "@/lib/constants";

interface TimeEntry {
  id: number;
  employeeId: number;
  type: string;
  timestamp: string;
  date: string;
}

interface BreakInfo {
  onBreak: boolean;
  currentBreakMinutes: number;
  totalBreakMinutes: number;
  breakCount: number;
}

interface NoBreakWarning {
  workedMinutes: number;
}

type ClockStatus =
  | { kind: "on-time"; clockInTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "clocked-late"; clockInTime: string; minutesLate: number; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "not-yet"; minutesUntil: number }
  | { kind: "late"; minutesLate: number }
  | { kind: "very-late"; minutesLate: number }
  | { kind: "clocked-out"; clockInTime: string; clockOutTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "waiting" }
  | { kind: "working-no-schedule"; clockInTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "done-no-schedule"; clockInTime: string; clockOutTime: string; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null };

function getBreakInfo(entries: TimeEntry[], now: Date): BreakInfo {
  const breakStarts = entries.filter((e) => e.type === "break-start").map((e) => new Date(e.timestamp));
  const breakEnds = entries.filter((e) => e.type === "break-end").map((e) => new Date(e.timestamp));

  const onBreak = breakStarts.length > breakEnds.length;
  let totalBreakMinutes = 0;

  for (let i = 0; i < breakEnds.length; i++) {
    if (i < breakStarts.length) {
      totalBreakMinutes += differenceInMinutes(breakEnds[i], breakStarts[i]);
    }
  }

  let currentBreakMinutes = 0;
  if (onBreak && breakStarts.length > 0) {
    currentBreakMinutes = differenceInMinutes(now, breakStarts[breakStarts.length - 1]);
  }

  return {
    onBreak,
    currentBreakMinutes,
    totalBreakMinutes: totalBreakMinutes + currentBreakMinutes,
    breakCount: breakStarts.length,
  };
}

function getNoBreakWarning(entries: TimeEntry[], endTime: Date, breakInfo: BreakInfo): NoBreakWarning | null {
  if (breakInfo.breakCount > 0) return null;

  const clockIns = entries.filter((e) => e.type === "clock-in");
  if (clockIns.length === 0) return null;

  const lastClockIn = clockIns[clockIns.length - 1];
  const workedMinutes = differenceInMinutes(endTime, new Date(lastClockIn.timestamp));
  if (workedMinutes >= 375) {
    return { workedMinutes };
  }
  return null;
}

function getClockStatusForScheduled(shift: Shift, entries: TimeEntry[], now: Date): ClockStatus {
  const shiftStartParts = shift.startTime.split(":");
  const shiftStart = new Date(now);
  shiftStart.setHours(parseInt(shiftStartParts[0]), parseInt(shiftStartParts[1]), 0, 0);

  const clockIn = entries.find((e) => e.type === "clock-in");
  const clockOuts = entries.filter((e) => e.type === "clock-out");
  const clockIns = entries.filter((e) => e.type === "clock-in");
  const lastClockOut = clockOuts.length > 0 ? clockOuts[clockOuts.length - 1] : null;
  const lastClockIn = clockIns.length > 0 ? clockIns[clockIns.length - 1] : null;
  const breakInfo = getBreakInfo(entries, now);

  const isClockedOut = lastClockOut && lastClockIn && new Date(lastClockOut.timestamp) > new Date(lastClockIn.timestamp);

  if (isClockedOut && lastClockIn && lastClockOut) {
    const doneWarning = getNoBreakWarning(entries, new Date(lastClockOut.timestamp), breakInfo);
    return { kind: "clocked-out", clockInTime: lastClockIn.timestamp, clockOutTime: lastClockOut.timestamp, breakInfo, noBreakWarning: doneWarning };
  }

  if (clockIn) {
    const noBreakWarning = getNoBreakWarning(entries, now, breakInfo);
    const clockInTime = new Date(clockIn.timestamp);
    const minsLate = differenceInMinutes(clockInTime, shiftStart);
    if (minsLate <= 5) {
      return { kind: "on-time", clockInTime: clockIn.timestamp, breakInfo, noBreakWarning };
    }
    return { kind: "clocked-late", clockInTime: clockIn.timestamp, minutesLate: minsLate, breakInfo, noBreakWarning };
  }

  if (now < shiftStart) {
    const minsUntil = differenceInMinutes(shiftStart, now);
    if (minsUntil > 60) {
      return { kind: "waiting" };
    }
    return { kind: "not-yet", minutesUntil: minsUntil };
  }

  const minsLate = differenceInMinutes(now, shiftStart);
  if (minsLate >= 60) {
    return { kind: "very-late", minutesLate: minsLate };
  }
  return { kind: "late", minutesLate: minsLate };
}

function getClockStatusForUnscheduled(entries: TimeEntry[], now: Date): ClockStatus | null {
  const clockIns = entries.filter((e) => e.type === "clock-in");
  const clockOuts = entries.filter((e) => e.type === "clock-out");
  if (clockIns.length === 0) return null;

  const lastClockIn = clockIns[clockIns.length - 1];
  const lastClockOut = clockOuts.length > 0 ? clockOuts[clockOuts.length - 1] : null;
  const breakInfo = getBreakInfo(entries, now);

  const isClockedOut = lastClockOut && new Date(lastClockOut.timestamp) > new Date(lastClockIn.timestamp);

  if (isClockedOut && lastClockOut) {
    const doneWarning = getNoBreakWarning(entries, new Date(lastClockOut.timestamp), breakInfo);
    return { kind: "done-no-schedule", clockInTime: lastClockIn.timestamp, clockOutTime: lastClockOut.timestamp, breakInfo, noBreakWarning: doneWarning };
  }

  const noBreakWarning = getNoBreakWarning(entries, now, breakInfo);
  return { kind: "working-no-schedule", clockInTime: lastClockIn.timestamp, breakInfo, noBreakWarning };
}

function BreakBadge({ breakInfo, hasWarning, isDone }: { breakInfo: BreakInfo; hasWarning?: boolean; isDone?: boolean }) {
  if (breakInfo.onBreak) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30" data-testid="badge-on-break">
        <Coffee className="w-3 h-3 text-blue-600" />
        <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">On break · {breakInfo.currentBreakMinutes}min</span>
      </div>
    );
  }

  if (breakInfo.totalBreakMinutes > 0) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/70" data-testid="badge-break-taken">
        <Coffee className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Today · {breakInfo.totalBreakMinutes}min break</span>
      </div>
    );
  }

  if (hasWarning) return null;

  if (isDone) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/30" data-testid="badge-no-break-done">
        <Coffee className="w-3 h-3 text-muted-foreground/50" />
        <span className="text-[10px] text-muted-foreground/60">Didn't take any break</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/30" data-testid="badge-no-break-yet">
      <Coffee className="w-3 h-3 text-muted-foreground/50" />
      <span className="text-[10px] text-muted-foreground/60">No break yet</span>
    </div>
  );
}

function NoBreakWarningBadge({ warning, isDone }: { warning: NoBreakWarning; isDone?: boolean }) {
  const hours = Math.floor(warning.workedMinutes / 60);
  const mins = warning.workedMinutes % 60;
  const label = isDone
    ? `Worked ${hours}h${mins > 0 ? `${mins}m` : ""} without any break`
    : `Over ${hours}h${mins > 0 ? `${mins}m` : ""} without a break`;
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30" data-testid="badge-no-break-warning">
      <AlertTriangle className="w-3 h-3 text-amber-600" />
      <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">{label}</span>
    </div>
  );
}

function StatusIndicator({ status }: { status: ClockStatus }) {
  const now = new Date();
  
  switch (status.kind) {
    case "on-time": {
      const workedMins = differenceInMinutes(now, parseISO(status.clockInTime));
      const h = Math.floor(workedMins / 60);
      const m = workedMins % 60;
      const hasWarning = !!status.noBreakWarning && !status.breakInfo.onBreak;
      return (
        <div className="flex flex-col gap-1" data-testid="status-on-time">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              <span className="text-[11px] font-medium text-green-700 dark:text-green-400">Clocked in on time ({format(parseISO(status.clockInTime), "h:mma")})</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5">Working for {h > 0 ? `${h}h ` : ""}{m}m</span>
          </div>
          <div className="flex flex-wrap gap-1 ml-5">
            <BreakBadge breakInfo={status.breakInfo} hasWarning={hasWarning} />
            {hasWarning && <NoBreakWarningBadge warning={status.noBreakWarning!} />}
          </div>
        </div>
      );
    }
    case "clocked-late": {
      const workedMins = differenceInMinutes(now, parseISO(status.clockInTime));
      const h = Math.floor(workedMins / 60);
      const m = workedMins % 60;
      const hasWarning = !!status.noBreakWarning && !status.breakInfo.onBreak;
      return (
        <div className="flex flex-col gap-1" data-testid="status-clocked-late">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Clocked in {status.minutesLate}min late ({format(parseISO(status.clockInTime), "h:mma")})</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5">Working for {h > 0 ? `${h}h ` : ""}{m}m</span>
          </div>
          <div className="flex flex-wrap gap-1 ml-5">
            <BreakBadge breakInfo={status.breakInfo} hasWarning={hasWarning} />
            {hasWarning && <NoBreakWarningBadge warning={status.noBreakWarning!} />}
          </div>
        </div>
      );
    }
    case "not-yet":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-not-yet">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Starts in {status.minutesUntil}min</span>
        </div>
      );
    case "late":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-late">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
          <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400">Not yet clocked in · {status.minutesLate}min late</span>
        </div>
      );
    case "very-late":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-very-late">
          <XCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Not yet at work · {status.minutesLate}min late</span>
        </div>
      );
    case "clocked-out": {
      const totalMins = differenceInMinutes(parseISO(status.clockOutTime), parseISO(status.clockInTime));
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      const hasWarning = !!status.noBreakWarning;
      return (
        <div className="flex flex-col gap-1" data-testid="status-clocked-out">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Worked {format(parseISO(status.clockInTime), "h:mma")} - {format(parseISO(status.clockOutTime), "h:mma")}</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5">Total time: {h > 0 ? `${h}h ` : ""}{m}m</span>
          </div>
          <div className="flex flex-wrap gap-1 ml-5">
            <BreakBadge breakInfo={status.breakInfo} hasWarning={hasWarning} isDone />
            {hasWarning && <NoBreakWarningBadge warning={status.noBreakWarning!} isDone />}
          </div>
        </div>
      );
    }
    case "waiting":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-waiting">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Waiting for shift</span>
        </div>
      );
    case "working-no-schedule": {
      const workedMins = differenceInMinutes(now, parseISO(status.clockInTime));
      const h = Math.floor(workedMins / 60);
      const m = workedMins % 60;
      const hasWarning = !!status.noBreakWarning && !status.breakInfo.onBreak;
      return (
        <div className="flex flex-col gap-1" data-testid="status-working-no-schedule">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              <span className="text-[11px] font-medium text-green-700 dark:text-green-400">Working since {format(parseISO(status.clockInTime), "h:mma")} (no schedule)</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5">Working for {h > 0 ? `${h}h ` : ""}{m}m</span>
          </div>
          <div className="flex flex-wrap gap-1 ml-5">
            <BreakBadge breakInfo={status.breakInfo} hasWarning={hasWarning} />
            {hasWarning && <NoBreakWarningBadge warning={status.noBreakWarning!} />}
          </div>
        </div>
      );
    }
    case "done-no-schedule": {
      const totalMins = differenceInMinutes(parseISO(status.clockOutTime), parseISO(status.clockInTime));
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      const hasWarning = !!status.noBreakWarning;
      return (
        <div className="flex flex-col gap-1" data-testid="status-done-no-schedule">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Worked {format(parseISO(status.clockInTime), "h:mma")} - {format(parseISO(status.clockOutTime), "h:mma")} (no schedule)</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5">Total time: {h > 0 ? `${h}h ` : ""}{m}m</span>
          </div>
          <div className="flex flex-wrap gap-1 ml-5">
            <BreakBadge breakInfo={status.breakInfo} hasWarning={hasWarning} isDone />
            {hasWarning && <NoBreakWarningBadge warning={status.noBreakWarning!} isDone />}
          </div>
        </div>
      );
    }
  }
}

interface FlowRow {
  employee: Employee;
  shift: Shift | null;
  status: ClockStatus;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const { data: shifts = [], isLoading: shiftsLoading } = useQuery<Shift[]>({
    queryKey: ["/api/shifts"],
  });

  const { data: employees = [], isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const { data: todayEntries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: [`/api/kiosk/entries?date=${todayStr}`],
    refetchInterval: 30000,
  });

  const isLoading = shiftsLoading || employeesLoading || entriesLoading;

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const entriesByEmployee = useMemo(() => {
    const map = new Map<number, TimeEntry[]>();
    todayEntries.forEach((e) => {
      const list = map.get(e.employeeId) || [];
      list.push(e);
      map.set(e.employeeId, list);
    });
    return map;
  }, [todayEntries]);

  const todayShifts = useMemo(() =>
    shifts.filter((s) => s.date === todayStr),
    [shifts, todayStr]
  );

  const now = new Date();

  const flowRows: FlowRow[] = useMemo(() => {
    const rows: FlowRow[] = [];
    const includedEmployeeIds = new Set<number>();

    todayShifts.forEach((shift) => {
      const emp = employeeMap.get(shift.employeeId);
      if (!emp) return;
      const entries = entriesByEmployee.get(shift.employeeId) || [];
      const status = getClockStatusForScheduled(shift, entries, now);
      rows.push({ employee: emp, shift, status });
      includedEmployeeIds.add(emp.id);
    });

    entriesByEmployee.forEach((entries, employeeId) => {
      if (includedEmployeeIds.has(employeeId)) return;
      const emp = employeeMap.get(employeeId);
      if (!emp || emp.status !== "active") return;
      const status = getClockStatusForUnscheduled(entries, now);
      if (status) {
        rows.push({ employee: emp, shift: null, status });
        includedEmployeeIds.add(emp.id);
      }
    });

    return rows;
  }, [todayShifts, employeeMap, entriesByEmployee, now]);

  const sortedRows = useMemo(() => {
    const priority: Record<string, number> = {
      "very-late": 0,
      "late": 1,
      "on-time": 2,
      "clocked-late": 3,
      "working-no-schedule": 4,
      "not-yet": 5,
      "clocked-out": 6,
      "done-no-schedule": 7,
      "waiting": 8,
    };
    return [...flowRows].sort((a, b) => {
      const pa = priority[a.status.kind] ?? 99;
      const pb = priority[b.status.kind] ?? 99;
      if (pa !== pb) return pa - pb;
      if (a.status.kind === "waiting" && b.status.kind === "waiting" && a.shift && b.shift) {
        return a.shift.startTime.localeCompare(b.shift.startTime);
      }
      return a.employee.name.localeCompare(b.employee.name);
    });
  }, [flowRows]);

  const inFlowIds = useMemo(() => {
    const ids = new Set<number>();
    todayShifts.forEach((s) => ids.add(s.employeeId));
    todayEntries.filter((e) => e.type === "clock-in").forEach((e) => ids.add(e.employeeId));
    return ids;
  }, [todayShifts, todayEntries]);

  const unscheduledEmployees = employees.filter(
    (e) => e.status === "active" && !inFlowIds.has(e.id)
  );

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center gap-3 p-4 border-b">
        <Calendar className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-dashboard-title">Dashboard</h2>
          <p className="text-xs text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold" data-testid="text-flow">Flow</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/schedule")}
              data-testid="button-view-schedule"
            >
              View Schedule <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CalendarDays className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No one working or scheduled today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedRows.map(({ employee: emp, shift, status }) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50"
                  data-testid={`flow-row-${emp.id}`}
                >
                  <div
                    className="w-1 h-10 rounded-full flex-shrink-0"
                    style={{ backgroundColor: shift?.color || emp.color || "#8B9E8B" }}
                  />
                  <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium truncate">{emp.name}</span>
                      {shift && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                        </span>
                      )}
                    </div>
                    <StatusIndicator status={status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {!isLoading && unscheduledEmployees.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold" data-testid="text-unscheduled">Unscheduled Employees Today</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {unscheduledEmployees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/50"
                  data-testid={`unscheduled-${emp.id}`}
                >
                  <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />
                  <span className="text-xs">{emp.name}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
