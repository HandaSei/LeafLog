import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, differenceInMinutes, parseISO } from "date-fns";
import type { Shift, Employee } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, ArrowRight, CalendarDays, AlertCircle, CheckCircle2, Clock, AlertTriangle, XCircle } from "lucide-react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { formatTime } from "@/lib/constants";

interface TimeEntry {
  id: number;
  employeeId: number;
  type: string;
  timestamp: string;
  date: string;
}

type ClockStatus =
  | { kind: "on-time" }
  | { kind: "clocked-late"; minutesLate: number }
  | { kind: "not-yet"; minutesUntil: number }
  | { kind: "late"; minutesLate: number }
  | { kind: "very-late"; minutesLate: number }
  | { kind: "on-break" }
  | { kind: "clocked-out" }
  | { kind: "upcoming" };

function getClockStatus(shift: Shift, entries: TimeEntry[], now: Date): ClockStatus {
  const shiftStartParts = shift.startTime.split(":");
  const shiftStart = new Date(now);
  shiftStart.setHours(parseInt(shiftStartParts[0]), parseInt(shiftStartParts[1]), 0, 0);

  const shiftEndParts = shift.endTime.split(":");
  const shiftEnd = new Date(now);
  shiftEnd.setHours(parseInt(shiftEndParts[0]), parseInt(shiftEndParts[1]), 0, 0);

  const clockIn = entries.find((e) => e.type === "clock-in");
  const clockOut = entries.find((e) => e.type === "clock-out");
  const breakStart = entries.filter((e) => e.type === "break-start");
  const breakEnd = entries.filter((e) => e.type === "break-end");

  if (clockOut) {
    return { kind: "clocked-out" };
  }

  if (clockIn) {
    if (breakStart.length > breakEnd.length) {
      return { kind: "on-break" };
    }
    const clockInTime = new Date(clockIn.timestamp);
    const minsLate = differenceInMinutes(clockInTime, shiftStart);
    if (minsLate <= 5) {
      return { kind: "on-time" };
    }
    return { kind: "clocked-late", minutesLate: minsLate };
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

function StatusIndicator({ status }: { status: ClockStatus }) {
  switch (status.kind) {
    case "on-time":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-on-time">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
          <span className="text-[11px] font-medium text-green-700">Clocked in on time</span>
        </div>
      );
    case "clocked-late":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-clocked-late">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[11px] font-medium text-amber-600">Clocked in {status.minutesLate}min late</span>
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
          <span className="text-[11px] font-medium text-orange-600">Not yet at work &middot; {status.minutesLate}min late</span>
        </div>
      );
    case "very-late":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-very-late">
          <XCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-[11px] font-semibold text-red-600">Missing &middot; {status.minutesLate}min late</span>
        </div>
      );
    case "on-break":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-on-break">
          <Clock className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-[11px] font-medium text-blue-600">On break</span>
        </div>
      );
    case "clocked-out":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-clocked-out">
          <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Shift completed</span>
        </div>
      );
    case "upcoming":
      return (
        <div className="flex items-center gap-1.5" data-testid="status-upcoming">
          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Upcoming</span>
        </div>
      );
  }
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
    shifts
      .filter((s) => s.date === todayStr)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [shifts, todayStr]
  );

  const todayEmployeeIds = new Set(todayShifts.map((s) => s.employeeId));
  const uncoveredEmployees = employees.filter(
    (e) => e.status === "active" && !todayEmployeeIds.has(e.id)
  );

  const now = new Date();

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
            <h3 className="text-sm font-semibold">Today's Schedule</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/schedule")}
              data-testid="button-view-schedule"
            >
              View All <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </div>
          ) : todayShifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CalendarDays className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No shifts scheduled today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayShifts.map((shift) => {
                const emp = employeeMap.get(shift.employeeId);
                const empEntries = entriesByEmployee.get(shift.employeeId) || [];
                const status = getClockStatus(shift, empEntries, now);

                return (
                  <div
                    key={shift.id}
                    className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50"
                    data-testid={`today-shift-${shift.id}`}
                  >
                    <div
                      className="w-1 h-10 rounded-full flex-shrink-0"
                      style={{ backgroundColor: shift.color || emp?.color || "#8B9E8B" }}
                    />
                    {emp && <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium truncate">{emp?.name || "Unknown"}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                        </span>
                      </div>
                      <StatusIndicator status={status} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {!isLoading && uncoveredEmployees.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Unscheduled Employees Today</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {uncoveredEmployees.map((emp) => (
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
