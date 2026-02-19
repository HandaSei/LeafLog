import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isSameDay, differenceInMinutes, parse, addDays } from "date-fns";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Clock, Edit2 } from "lucide-react";
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
import type { Employee, Shift, TimeEntry } from "@shared/schema";

function calculateShiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }
  return (endMinutes - startMinutes) / 60;
}

function formatShiftTime(time: string): string {
  const [h, m] = time.split(":");
  return `${h}:${m}`;
}

export default function Timesheets() {
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [viewingShift, setViewingShift] = useState<{ shift: Shift; employee: Employee } | null>(null);
  const { toast } = useToast();

  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekDays = useMemo(() => eachDayOfInterval({ start: selectedWeek, end: weekEnd }), [selectedWeek]);

  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: shifts = [], isLoading: shiftsLoading } = useQuery<Shift[]>({
    queryKey: ["/api/shifts"],
  });

  const { data: entries = [] } = useQuery<TimeEntry[]>({
    queryKey: ["/api/kiosk/entries"],
  });

  const updateEntryMutation = useMutation({
    mutationFn: async (entry: Partial<TimeEntry> & { id: number }) => {
      const res = await apiRequest("PATCH", `/api/kiosk/entries/${entry.id}`, entry);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk/entries"] });
      toast({ title: "Success", description: "Entry updated successfully" });
      setEditingEntry(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const navigateWeek = (direction: number) => {
    const next = new Date(selectedWeek);
    next.setDate(next.getDate() + (direction * 7));
    setSelectedWeek(startOfWeek(next, { weekStartsOn: 1 }));
    setSelectedDay(null);
  };

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    employees.forEach(e => map.set(e.id, e));
    return map;
  }, [employees]);

  const filteredShifts = useMemo(() => {
    return shifts.filter(shift => {
      const shiftDate = new Date(shift.date + "T00:00:00");
      const inWeek = shiftDate >= selectedWeek && shiftDate <= weekEnd;
      if (!inWeek) return false;

      if (selectedDay && !isSameDay(shiftDate, selectedDay)) return false;

      if (selectedRole !== "all") {
        const emp = employeeMap.get(shift.employeeId);
        if (!emp || emp.role !== selectedRole) return false;
      }

      return true;
    }).sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [shifts, selectedWeek, weekEnd, selectedDay, selectedRole, employeeMap]);

  const totalHours = useMemo(() => {
    return filteredShifts.reduce((sum, s) => sum + calculateShiftHours(s.startTime, s.endTime), 0);
  }, [filteredShifts]);

  const statusColors: Record<string, string> = {
    scheduled: "#3B82F6",
    "in-progress": "#F59E0B",
    completed: "#10B981",
    cancelled: "#EF4444",
  };

  const statusLabels: Record<string, string> = {
    scheduled: "Pending",
    "in-progress": "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  if (empsLoading || shiftsLoading) {
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

        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" data-testid="text-week-month">
            {format(selectedWeek, "MMM yyyy")}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigateWeek(-1)} data-testid="button-week-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigateWeek(1)} data-testid="button-week-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-1">
          {weekDays.map(day => {
            const dayIsToday = isToday(day);
            const dayIsSelected = selectedDay && isSameDay(day, selectedDay);
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(prev => prev && isSameDay(prev, day) ? null : day)}
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

        <div className="flex items-center gap-2 pb-2">
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
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4 space-y-3">
        {filteredShifts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No shifts found for this period.
          </div>
        ) : (
          filteredShifts.map(shift => {
            const emp = employeeMap.get(shift.employeeId);
            if (!emp) return null;
            const hours = calculateShiftHours(shift.startTime, shift.endTime);
            const statusColor = statusColors[shift.status] || "#6B7280";
            const statusLabel = statusLabels[shift.status] || shift.status;

            return (
              <button
                key={shift.id}
                onClick={() => setViewingShift({ shift, employee: emp })}
                className="w-full flex items-start gap-3 p-4 rounded-md border bg-card hover-elevate text-left cursor-pointer"
                data-testid={`timesheet-card-${shift.id}`}
              >
                <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{emp.name}</span>
                    <span className="text-xs font-semibold whitespace-nowrap" style={{ color: statusColor }}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="text-base font-bold mt-0.5" data-testid={`text-shift-time-${shift.id}`}>
                    {formatShiftTime(shift.startTime)} - {formatShiftTime(shift.endTime)}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{emp.department}</span>
                    <span className="text-sm font-semibold text-muted-foreground">{hours.toFixed(2)} h</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {filteredShifts.length > 0 && (
        <div className="border-t px-4 py-3 flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-lg font-bold" data-testid="text-total-hours">{totalHours.toFixed(2)} h</span>
        </div>
      )}

      <Dialog open={!!viewingShift} onOpenChange={() => setViewingShift(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Shift Details</DialogTitle>
          </DialogHeader>
          {viewingShift && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <EmployeeAvatar name={viewingShift.employee.name} color={viewingShift.employee.color} size="lg" />
                <div>
                  <div className="font-semibold">{viewingShift.employee.name}</div>
                  <div className="text-xs text-muted-foreground">{viewingShift.employee.department} &middot; {viewingShift.employee.role}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Date</div>
                  <div className="font-medium">{format(new Date(viewingShift.shift.date + "T00:00:00"), "EEE, MMM d, yyyy")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Hours</div>
                  <div className="font-medium">{calculateShiftHours(viewingShift.shift.startTime, viewingShift.shift.endTime).toFixed(2)} h</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Start</div>
                  <div className="font-medium">{formatShiftTime(viewingShift.shift.startTime)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">End</div>
                  <div className="font-medium">{formatShiftTime(viewingShift.shift.endTime)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Status</div>
                  <span className="text-xs font-semibold" style={{ color: statusColors[viewingShift.shift.status] || "#6B7280" }}>
                    {statusLabels[viewingShift.shift.status] || viewingShift.shift.status}
                  </span>
                </div>
              </div>
              {viewingShift.shift.notes && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Notes</div>
                  <div className="text-sm">{viewingShift.shift.notes}</div>
                </div>
              )}

              {(() => {
                const dayEntries = entries.filter(
                  e => e.employeeId === viewingShift.shift.employeeId && e.date === viewingShift.shift.date
                ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                if (dayEntries.length === 0) return null;
                return (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">SteepIn Activity</div>
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
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingEntry(entry)}>
                                <Edit2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingEntry} onOpenChange={() => setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Action</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={editingEntry?.type}
                onValueChange={(val: any) => setEditingEntry(prev => prev ? { ...prev, type: val } : null)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clock-in">Clock In</SelectItem>
                  <SelectItem value="clock-out">Clock Out</SelectItem>
                  <SelectItem value="break-start">Break Start</SelectItem>
                  <SelectItem value="break-end">Break End</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timestamp</Label>
              <Input
                type="datetime-local"
                value={editingEntry ? format(new Date(editingEntry.timestamp), "yyyy-MM-dd'T'HH:mm") : ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditingEntry(prev => prev ? { ...prev, timestamp: new Date(val) } : null);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>Cancel</Button>
            <Button
              onClick={() => editingEntry && updateEntryMutation.mutate({
                id: editingEntry.id,
                type: editingEntry.type,
                timestamp: editingEntry.timestamp
              })}
              disabled={updateEntryMutation.isPending}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
