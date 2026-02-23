import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isSameDay, differenceInMinutes } from "date-fns";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Edit2, Plus, Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { ROLES } from "@/lib/constants";
import type { Employee, TimeEntry } from "@shared/schema";

interface EmployeeWorkday {
  employee: Employee;
  entries: TimeEntry[];
  clockIn: Date | null;
  clockOut: Date | null;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  netWorkedMinutes: number;
  status: "working" | "on-break" | "completed";
}

function buildWorkdays(entries: TimeEntry[], employees: Employee[], selectedDay: Date, selectedRole: string): EmployeeWorkday[] {
  const dateStr = format(selectedDay, "yyyy-MM-dd");
  const empMap = new Map<number, Employee>();
  employees.forEach(e => empMap.set(e.id, e));

  const grouped = new Map<number, TimeEntry[]>();
  entries.forEach(entry => {
    if (entry.date !== dateStr) return;
    const list = grouped.get(entry.employeeId) || [];
    list.push(entry);
    grouped.set(entry.employeeId, list);
  });

  const workdays: EmployeeWorkday[] = [];

  grouped.forEach((dayEntries, employeeId) => {
    const emp = empMap.get(employeeId);
    if (!emp) return;
    if (selectedRole !== "all" && emp.role !== selectedRole) return;

    const sorted = [...dayEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let clockIn: Date | null = null;
    let clockOut: Date | null = null;
    let totalWorkedMinutes = 0;
    let totalBreakMinutes = 0;
    let status: "working" | "on-break" | "completed" = "working";

    let lastClockIn: Date | null = null;
    let lastBreakStart: Date | null = null;
    let onBreak = false;

    for (const entry of sorted) {
      const ts = new Date(entry.timestamp);
      switch (entry.type) {
        case "clock-in":
          if (!clockIn) clockIn = ts;
          lastClockIn = ts;
          onBreak = false;
          break;
        case "clock-out":
          clockOut = ts;
          if (lastClockIn) {
            totalWorkedMinutes += differenceInMinutes(ts, lastClockIn);
            lastClockIn = null;
          }
          break;
        case "break-start":
          lastBreakStart = ts;
          onBreak = true;
          if (lastClockIn) {
            totalWorkedMinutes += differenceInMinutes(ts, lastClockIn);
            lastClockIn = null;
          }
          break;
        case "break-end":
          onBreak = false;
          if (lastBreakStart) {
            totalBreakMinutes += differenceInMinutes(ts, lastBreakStart);
            lastBreakStart = null;
          }
          lastClockIn = ts;
          break;
      }
    }

    if (lastClockIn && !clockOut) {
      const now = new Date();
      totalWorkedMinutes += differenceInMinutes(now, lastClockIn);
    }
    if (lastBreakStart && onBreak) {
      const now = new Date();
      totalBreakMinutes += differenceInMinutes(now, lastBreakStart);
    }

    if (clockOut) {
      status = "completed";
    } else if (onBreak) {
      status = "on-break";
    } else {
      status = "working";
    }

    workdays.push({
      employee: emp,
      entries: sorted,
      clockIn,
      clockOut,
      totalWorkedMinutes,
      totalBreakMinutes,
      netWorkedMinutes: totalWorkedMinutes,
      status,
    });
  });

  workdays.sort((a, b) => {
    if (a.clockIn && b.clockIn) return a.clockIn.getTime() - b.clockIn.getTime();
    if (a.clockIn) return -1;
    if (b.clockIn) return 1;
    return 0;
  });

  return workdays;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function formatHoursDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export default function Timesheets() {
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editTime, setEditTime] = useState<string>("");
  const [viewingWorkday, setViewingWorkday] = useState<EmployeeWorkday | null>(null);
  const [addingTimesheet, setAddingTimesheet] = useState(false);
  const [newTimesheetEmployeeId, setNewTimesheetEmployeeId] = useState<string>("");
  const [newTimesheetClockIn, setNewTimesheetClockIn] = useState<string>("");
  const [newTimesheetClockOut, setNewTimesheetClockOut] = useState<string>("");
  const [addingClockOut, setAddingClockOut] = useState<EmployeeWorkday | null>(null);
  const [clockOutTime, setClockOutTime] = useState<string>("");
  const { toast } = useToast();

  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekDays = useMemo(() => eachDayOfInterval({ start: selectedWeek, end: weekEnd }), [selectedWeek]);

  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/kiosk/entries"],
  });

  const updateEntryMutation = useMutation({
    mutationFn: async (data: { id: number; timestamp: string }) => {
      const res = await apiRequest("PATCH", `/api/kiosk/entries/${data.id}`, { timestamp: data.timestamp });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk/entries"] });
      toast({ title: "Success", description: "Time updated successfully" });
      setEditingEntry(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addEntryMutation = useMutation({
    mutationFn: async (data: { employeeId: number; type: string; date: string; timestamp: string }) => {
      const res = await apiRequest("POST", "/api/kiosk/entries", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk/entries"] });
      toast({ title: "Success", description: "Entry added successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const navigateWeek = (direction: number) => {
    const next = new Date(selectedWeek);
    next.setDate(next.getDate() + (direction * 7));
    const newWeekStart = startOfWeek(next, { weekStartsOn: 1 });
    setSelectedWeek(newWeekStart);
    setSelectedDay(newWeekStart);
  };

  const workdays = useMemo(
    () => buildWorkdays(entries, employees, selectedDay, selectedRole),
    [entries, employees, selectedDay, selectedRole]
  );

  const totalHours = useMemo(() => {
    return workdays.reduce((sum, w) => sum + w.netWorkedMinutes, 0);
  }, [workdays]);

  const statusConfig: Record<string, { label: string; color: string }> = {
    working: { label: "Working", color: "#10B981" },
    "on-break": { label: "On Break", color: "#F59E0B" },
    completed: { label: "Completed", color: "#3B82F6" },
  };

  const handleEditEntry = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditTime(format(new Date(entry.timestamp), "HH:mm"));
  };

  const handleSaveEdit = () => {
    if (!editingEntry || !editTime) return;
    const entryDate = editingEntry.date;
    const [hours, minutes] = editTime.split(":").map(Number);
    const newTimestamp = new Date(`${entryDate}T${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`);
    updateEntryMutation.mutate({ id: editingEntry.id, timestamp: newTimestamp.toISOString() });
  };

  const handleAddBreak = (wd: EmployeeWorkday) => {
    const dateStr = format(selectedDay, "yyyy-MM-dd");
    const now = new Date();
    const breakStartTime = format(now, "HH:mm");

    const breakStart = new Date(`${dateStr}T${breakStartTime}:00`);
    const breakEnd = new Date(breakStart.getTime() + 30 * 60 * 1000);

    addEntryMutation.mutate(
      { employeeId: wd.employee.id, type: "break-start", date: dateStr, timestamp: breakStart.toISOString() },
      {
        onSuccess: () => {
          addEntryMutation.mutate(
            { employeeId: wd.employee.id, type: "break-end", date: dateStr, timestamp: breakEnd.toISOString() },
            {
              onSuccess: () => {
                setViewingWorkday(null);
                toast({ title: "Success", description: "30-minute break added" });
              }
            }
          );
        }
      }
    );
  };

  const handleAddClockOut = () => {
    if (!addingClockOut || !clockOutTime) return;
    const dateStr = format(selectedDay, "yyyy-MM-dd");
    const ts = new Date(`${dateStr}T${clockOutTime}:00`);
    addEntryMutation.mutate(
      { employeeId: addingClockOut.employee.id, type: "clock-out", date: dateStr, timestamp: ts.toISOString() },
      {
        onSuccess: () => {
          setAddingClockOut(null);
          setClockOutTime("");
          setViewingWorkday(null);
        }
      }
    );
  };

  const handleAddTimesheet = () => {
    if (!newTimesheetEmployeeId || !newTimesheetClockIn) return;
    const dateStr = format(selectedDay, "yyyy-MM-dd");
    const clockInTs = new Date(`${dateStr}T${newTimesheetClockIn}:00`);

    addEntryMutation.mutate(
      { employeeId: Number(newTimesheetEmployeeId), type: "clock-in", date: dateStr, timestamp: clockInTs.toISOString() },
      {
        onSuccess: () => {
          if (newTimesheetClockOut) {
            const clockOutTs = new Date(`${dateStr}T${newTimesheetClockOut}:00`);
            addEntryMutation.mutate(
              { employeeId: Number(newTimesheetEmployeeId), type: "clock-out", date: dateStr, timestamp: clockOutTs.toISOString() },
              {
                onSuccess: () => {
                  setAddingTimesheet(false);
                  setNewTimesheetEmployeeId("");
                  setNewTimesheetClockIn("");
                  setNewTimesheetClockOut("");
                }
              }
            );
          } else {
            setAddingTimesheet(false);
            setNewTimesheetEmployeeId("");
            setNewTimesheetClockIn("");
            setNewTimesheetClockOut("");
          }
        }
      }
    );
  };

  if (empsLoading || entriesLoading) {
    return (
      <div className="h-full overflow-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-16 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex flex-col">
      <div className="p-4 pb-0 space-y-4">
        <h1 className="text-xl font-bold" data-testid="text-timesheets-title">Timesheets</h1>

        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigateWeek(-1)} data-testid="button-week-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold" data-testid="text-week-range">
            {format(selectedWeek, "MMM d")} - {format(weekEnd, "MMM d")}
          </span>
          <Button variant="ghost" size="icon" onClick={() => navigateWeek(1)} data-testid="button-week-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-1">
          {weekDays.map(day => {
            const dayIsToday = isToday(day);
            const dayIsSelected = isSameDay(day, selectedDay);
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-md flex-1 cursor-pointer transition-colors
                  ${dayIsSelected ? "bg-primary text-primary-foreground" : dayIsToday ? "bg-primary/10" : "hover-elevate"}`}
                data-testid={`button-day-${format(day, "EEE").toLowerCase()}`}
              >
                <span className="text-[10px] font-medium uppercase">{format(day, "EEEEE")}</span>
                <span className={`text-sm font-bold ${dayIsToday && !dayIsSelected ? "flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground" : ""}`}>
                  {format(day, "d")}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pb-2">
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="w-[160px]" data-testid="select-role-filter">
              <SelectValue placeholder="All Positions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Positions</SelectItem>
              {ROLES.map(role => (
                <SelectItem key={role} value={role}>{role}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingTimesheet(true)}
            data-testid="button-add-timesheet"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Timesheet
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4 space-y-3">
        {workdays.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No one worked on this day.
          </div>
        ) : (
          workdays.map(wd => {
            const { employee: emp, clockIn, clockOut, netWorkedMinutes, totalBreakMinutes, status } = wd;
            const sc = statusConfig[status];

            return (
              <button
                key={emp.id}
                onClick={() => setViewingWorkday(wd)}
                className="w-full flex items-start gap-3 p-4 rounded-md border bg-card hover-elevate text-left cursor-pointer"
                data-testid={`timesheet-card-${emp.id}`}
              >
                <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{emp.name}</span>
                    <span className="text-xs font-semibold whitespace-nowrap" style={{ color: sc.color }}>
                      {sc.label}
                    </span>
                  </div>
                  <div className="text-base font-bold mt-0.5" data-testid={`text-work-time-${emp.id}`}>
                    {clockIn ? format(clockIn, "HH:mm") : "--:--"} - {clockOut ? format(clockOut, "HH:mm") : ""}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{emp.department}</span>
                    <span className="text-sm font-semibold text-muted-foreground">{formatHoursDecimal(netWorkedMinutes)} h</span>
                  </div>
                  {totalBreakMinutes > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Break: {formatMinutes(totalBreakMinutes)}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {workdays.length > 0 && (
        <div className="border-t px-4 py-3 flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-lg font-bold" data-testid="text-total-hours">{formatHoursDecimal(totalHours)} h</span>
        </div>
      )}

      <Dialog open={!!viewingWorkday} onOpenChange={() => setViewingWorkday(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Timesheet Details</DialogTitle>
          </DialogHeader>
          {viewingWorkday && (() => {
            const { employee: emp, entries: dayEntries, clockIn, clockOut, netWorkedMinutes, totalBreakMinutes, status } = viewingWorkday;
            const sc = statusConfig[status];
            const hasBreak = dayEntries.some(e => e.type === "break-start");
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
                  <div>
                    <div className="font-semibold">{emp.name}</div>
                    <div className="text-xs text-muted-foreground">{emp.department} &middot; {emp.role}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Date</div>
                    <div className="font-medium">{format(selectedDay, "EEE, MMM d, yyyy")}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Status</div>
                    <span className="text-xs font-semibold" style={{ color: sc.color }}>{sc.label}</span>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Clock In</div>
                    <div className="font-medium">{clockIn ? format(clockIn, "HH:mm:ss") : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Clock Out</div>
                    {clockOut ? (
                      <div className="font-medium">{format(clockOut, "HH:mm:ss")}</div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setAddingClockOut(viewingWorkday);
                          setClockOutTime(format(new Date(), "HH:mm"));
                        }}
                        data-testid="button-add-clock-out"
                      >
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </Button>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Worked</div>
                    <div className="font-medium">{formatMinutes(netWorkedMinutes)} ({formatHoursDecimal(netWorkedMinutes)} h)</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Break</div>
                    <div className="font-medium">{totalBreakMinutes > 0 ? formatMinutes(totalBreakMinutes) : "No break"}</div>
                  </div>
                </div>

                {!hasBreak && status !== "completed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleAddBreak(viewingWorkday!)}
                    disabled={addEntryMutation.isPending}
                    data-testid="button-add-break"
                  >
                    <Coffee className="w-4 h-4 mr-2" />
                    Add 30min Break
                  </Button>
                )}

                <div>
                  <div className="text-xs text-muted-foreground mb-2">Activity Log</div>
                  <div className="space-y-1.5">
                    {dayEntries.map(entry => {
                      const typeLabels: Record<string, { label: string; color: string }> = {
                        "clock-in": { label: "Clock In", color: "#10B981" },
                        "clock-out": { label: "Clock Out", color: "#EF4444" },
                        "break-start": { label: "Break Start", color: "#F59E0B" },
                        "break-end": { label: "Break End", color: "#3B82F6" },
                      };
                      const info = typeLabels[entry.type] || { label: entry.type, color: "#6B7280" };
                      return (
                        <div key={entry.id} className="flex items-center justify-between text-xs p-2 rounded-md border">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                            <span>{info.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground font-mono">
                              {format(new Date(entry.timestamp), "HH:mm:ss")}
                            </span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleEditEntry(entry)} data-testid={`button-edit-entry-${entry.id}`}>
                              <Edit2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingEntry} onOpenChange={() => setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Time</DialogTitle>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-4 py-4">
              <div className="text-sm text-muted-foreground">
                {(() => {
                  const typeLabels: Record<string, string> = {
                    "clock-in": "Clock In",
                    "clock-out": "Clock Out",
                    "break-start": "Break Start",
                    "break-end": "Break End",
                  };
                  return typeLabels[editingEntry.type] || editingEntry.type;
                })()}
                {" — "}
                {format(new Date(editingEntry.timestamp), "EEE, MMM d, yyyy")}
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  data-testid="input-edit-time"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>Cancel</Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateEntryMutation.isPending}
              data-testid="button-save-edit"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addingClockOut} onOpenChange={() => setAddingClockOut(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Clock Out</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              {addingClockOut?.employee.name} — {format(selectedDay, "EEE, MMM d, yyyy")}
            </div>
            <div className="space-y-2">
              <Label>Clock Out Time</Label>
              <Input
                type="time"
                value={clockOutTime}
                onChange={(e) => setClockOutTime(e.target.value)}
                data-testid="input-clock-out-time"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingClockOut(null)}>Cancel</Button>
            <Button
              onClick={handleAddClockOut}
              disabled={addEntryMutation.isPending}
              data-testid="button-save-clock-out"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addingTimesheet} onOpenChange={setAddingTimesheet}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Missing Timesheet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              {format(selectedDay, "EEEE, MMM d, yyyy")}
            </div>
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={newTimesheetEmployeeId} onValueChange={setNewTimesheetEmployeeId}>
                <SelectTrigger data-testid="select-timesheet-employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter(e => e.status === "active")
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(emp => (
                      <SelectItem key={emp.id} value={String(emp.id)}>{emp.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Clock In Time</Label>
              <Input
                type="time"
                value={newTimesheetClockIn}
                onChange={(e) => setNewTimesheetClockIn(e.target.value)}
                data-testid="input-timesheet-clock-in"
              />
            </div>
            <div className="space-y-2">
              <Label>Clock Out Time (optional)</Label>
              <Input
                type="time"
                value={newTimesheetClockOut}
                onChange={(e) => setNewTimesheetClockOut(e.target.value)}
                data-testid="input-timesheet-clock-out"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingTimesheet(false)}>Cancel</Button>
            <Button
              onClick={handleAddTimesheet}
              disabled={addEntryMutation.isPending || !newTimesheetEmployeeId || !newTimesheetClockIn}
              data-testid="button-save-timesheet"
            >
              Add Timesheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
