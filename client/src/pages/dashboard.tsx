import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, isToday, isTomorrow, parseISO, startOfWeek, endOfWeek } from "date-fns";
import type { Shift, Employee } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Users, Clock, TrendingUp, ArrowRight, CalendarDays, AlertCircle } from "lucide-react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { formatTime } from "@/lib/constants";

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const { data: shifts = [], isLoading: shiftsLoading } = useQuery<Shift[]>({
    queryKey: ["/api/shifts"],
  });

  const { data: employees = [], isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const isLoading = shiftsLoading || employeesLoading;

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = format(tomorrowDate, "yyyy-MM-dd");

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  const todayShifts = useMemo(() => shifts.filter((s) => s.date === todayStr), [shifts, todayStr]);
  const tomorrowShifts = useMemo(() => shifts.filter((s) => s.date === tomorrowStr), [shifts, tomorrowStr]);
  const weekShifts = useMemo(() => {
    return shifts.filter((s) => {
      const d = parseISO(s.date);
      return d >= weekStart && d <= weekEnd;
    });
  }, [shifts, weekStart, weekEnd]);

  const activeEmployees = employees.filter((e) => e.status === "active").length;

  const todayEmployeeIds = new Set(todayShifts.map((s) => s.employeeId));
  const uncoveredEmployees = employees.filter(
    (e) => e.status === "active" && !todayEmployeeIds.has(e.id)
  );

  const stats = [
    {
      label: "Today's Shifts",
      value: todayShifts.length,
      icon: CalendarDays,
      color: "#3B82F6",
    },
    {
      label: "Active Employees",
      value: activeEmployees,
      icon: Users,
      color: "#10B981",
    },
    {
      label: "This Week",
      value: weekShifts.length,
      icon: TrendingUp,
      color: "#8B5CF6",
    },
    {
      label: "Unscheduled Today",
      value: uncoveredEmployees.length,
      icon: AlertCircle,
      color: "#F59E0B",
    },
  ];

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
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-md" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.map((stat) => (
              <Card key={stat.label} className="p-4" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  </div>
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center"
                    style={{ backgroundColor: stat.color + "15" }}
                  >
                    <stat.icon className="w-5 h-5" style={{ color: stat.color }} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-md" />
                ))}
              </div>
            ) : todayShifts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CalendarDays className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No shifts scheduled today</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayShifts.slice(0, 5).map((shift) => {
                  const emp = employeeMap.get(shift.employeeId);
                  return (
                    <div
                      key={shift.id}
                      className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                      data-testid={`today-shift-${shift.id}`}
                    >
                      <div
                        className="w-1 h-8 rounded-full"
                        style={{ backgroundColor: shift.color || emp?.color || "#3B82F6" }}
                      />
                      {emp && <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{shift.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {emp?.name} &middot; {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className="text-[10px]"
                        style={
                          shift.status === "scheduled"
                            ? { backgroundColor: "#3B82F615", color: "#3B82F6" }
                            : shift.status === "in-progress"
                              ? { backgroundColor: "#F59E0B15", color: "#F59E0B" }
                              : { backgroundColor: "#10B98115", color: "#10B981" }
                        }
                      >
                        {shift.status}
                      </Badge>
                    </div>
                  );
                })}
                {todayShifts.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    +{todayShifts.length - 5} more shifts
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold">Upcoming Tomorrow</h3>
              <Badge variant="secondary" className="text-xs">{tomorrowShifts.length} shifts</Badge>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-md" />
                ))}
              </div>
            ) : tomorrowShifts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Clock className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No shifts scheduled tomorrow</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tomorrowShifts.slice(0, 5).map((shift) => {
                  const emp = employeeMap.get(shift.employeeId);
                  return (
                    <div
                      key={shift.id}
                      className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                      data-testid={`tomorrow-shift-${shift.id}`}
                    >
                      <div
                        className="w-1 h-8 rounded-full"
                        style={{ backgroundColor: shift.color || emp?.color || "#3B82F6" }}
                      />
                      {emp && <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{shift.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {emp?.name} &middot; {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

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
