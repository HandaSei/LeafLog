import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, differenceInMinutes } from "date-fns";
import type { Shift, Employee } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, ArrowRight, CalendarDays, CheckCircle2, Clock, AlertTriangle, XCircle, Coffee, Ban } from "lucide-react";
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
  | { kind: "on-time"; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "clocked-late"; minutesLate: number; breakInfo: BreakInfo; noBreakWarning: NoBreakWarning | null }
  | { kind: "not-yet"; minutesUntil: number }
  | { kind: "late"; minutesLate: number }
  | { kind: "very-late"; minutesLate: number }
  | { kind: "clocked-out"; breakInfo: BreakInfo }
  | { kind: "upcoming" }
  | { kind: "no-schedule" };

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

function getNoBreakWarning(entries: TimeEntry[], now: Date, breakInfo: BreakInfo): NoBreakWarning | null {
  if (breakInfo.breakCount > 0) return null;

  const clockIn = entries.find((e) => e.type === "clock-in");
  if (!clockIn) return null;

  const workedMinutes = differenceInMinutes(now, new Date(clockIn.timestamp));
  if (workedMinutes >= 375) {
    return { workedMinutes };
  }
  return null;
}

function getClockStatus(shift: Shift | null, entries: TimeEntry[], now: Date): ClockStatus {
  if (!shift) {
    return { kind: "no-schedule" };
  }

  const shiftStartParts = shift.startTime.split(":");
  const shiftStart = new Date(now);
  shiftStart.setHours(parseInt(shiftStartParts[0]), parseInt(shiftStartParts[1]), 0, 0);

  const clockIn = entries.find((e) => e.type === "clock-in");
  const clockOut = entries.find((e) => e.type === "clock-out");
  const breakInfo = getBreakInfo(entries, now);

  if (clockOut) {
    return { kind: "clocked-out", breakInfo };
  }

  if (clockIn) {
    const noBreakWarning = getNoBreakWarning(entries, now, breakInfo);
    const clockInTime = new Date(clockIn.timestamp);
    const minsLate = differenceInMinutes(clockInTime, shiftStart);
    if (minsLate <= 5) {
      return { kind: "on-time", breakInfo, noBreakWarning };
    }
    return { kind: "clocked-late", minutesLate: minsLate, breakInfo, noBreakWarning };
  }

  if (now < shiftStart) {
    const minsUntil = differenceInMinutes(shiftStart, now);
    if (minsUntil > 60) {
      return { kind: "upcoming" };
    }
    return { kind: "not-yet", minutesUntil: minsUntil };
  }

  const minsLate = differenceInMinutes(now, shiftStart);
  if (minsLate >= 60) {
    return { kind: "very-late", minutesLate: minsLate };
  }
  return { kind: "late", minutesLate: minsLate };
}

function BreakBadge({ breakInfo }: { breakInfo: BreakInfo }) {
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

  return null;
}

function NoBreakWarningBadge({ warning }: { warning: NoBreakWarning }) {
  const hours = Math.floor(warning.workedMinutes / 60);
  const mins = warning.workedMinutes % 60;
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30" data-testid="badge-no-break-warning">
      <AlertTriangle className="w-3 h-3 text-amber-600" />
      <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">Over {hours}h{mins > 0 ? `${mins}m` : ""} without a break</span>
    </div>
  );
}

function StatusIndicator({ status }: { status: ClockStatus }) {
  switch (status.kind) {
    case "on-time":
      return (
        <div className="flex flex-col gap-1" data-testid="status-on-time">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
            <span className="text-[11px] font-medium text-green-700 dark:text-green-400">Clocked in on time</span>
          </div>
          {status.breakInfo.onBreak && <BreakBadge breakInfo={status.breakInfo} />}
          {!status.breakInfo.onBreak && status.breakInfo.totalBreakMinutes > 0 && <BreakBadge breakInfo={status.breakInfo} />}
          {status.noBreakWarning && !status.breakInfo.onBreak && <NoBreakWarningBadge warning={status.noBreakWarning} />}
        </div>
      );
    case "clocked-late":
      return (
        <div className="flex flex-col gap-1" data-testid="status-clocked-late">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Clocked in {status.minutesLate}min late</span>
          </div>
          {status.breakInfo.onBreak && <BreakBadge breakInfo={status.breakInfo} />}
          {!status.breakInfo.onBreak && status.breakInfo.totalBreakMinutes > 0 && <BreakBadge breakInfo={status.breakInfo} />}
          {status.noBreakWarning && !status.breakInfo.onBreak && <NoBreakWarningBadge warning={status.noBreakWarning} />}
        </div>
      );
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
    case "clocked-out":
      return (
        <div className="flex flex-col gap-1" data-testid="status-clocked-out">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Shift completed</span>
          </div>
          {status.breakInfo.totalBreakMinutes > 0 && <BreakBadge breakInfo={status.breakInfo} />}
        </div>
      );
    case "upcoming":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-upcoming">
          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Upcoming</span>
        </div>
      );
    case "no-schedule":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-no-schedule">
          <Ban className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">No schedule set for today</span>
        </div>
      );
  }
}

interface EmployeeRow {
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

  const shiftByEmployee = useMemo(() => {
    const map = new Map<number, Shift>();
    todayShifts.forEach((s) => map.set(s.employeeId, s));
    return map;
  }, [todayShifts]);

  const now = new Date();

  const employeeRows: EmployeeRow[] = useMemo(() => {
    const activeEmployees = employees.filter((e) => e.status === "active");
    return activeEmployees.map((emp) => {
      const shift = shiftByEmployee.get(emp.id) || null;
      const entries = entriesByEmployee.get(emp.id) || [];
      const status = getClockStatus(shift, entries, now);
      return { employee: emp, shift, status };
    });
  }, [employees, shiftByEmployee, entriesByEmployee, now]);

  const sortedRows = useMemo(() => {
    const priority: Record<string, number> = {
      "very-late": 0,
      "late": 1,
      "on-time": 2,
      "clocked-late": 3,
      "not-yet": 4,
      "upcoming": 5,
      "clocked-out": 6,
      "no-schedule": 7,
    };
    return [...employeeRows].sort((a, b) => {
      const pa = priority[a.status.kind] ?? 99;
      const pb = priority[b.status.kind] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.employee.name.localeCompare(b.employee.name);
    });
  }, [employeeRows]);

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
            <h3 className="text-sm font-semibold" data-testid="text-working-now">Working Right Now</h3>
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
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CalendarDays className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No active employees</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedRows.map(({ employee: emp, shift, status }) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50"
                  data-testid={`employee-row-${emp.id}`}
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
      </div>
    </div>
  );
}
