import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isSameDay,
  differenceInMinutes, startOfMonth, endOfMonth, addMonths, subMonths,
} from "date-fns";
import { useState, useMemo, useCallback } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Edit2, Plus, Coffee, Search, FileDown, Calendar, CalendarDays, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { TimeInput, TimeRangeInput, ClockPickerDialog } from "@/components/time-input";
import { DateInput } from "@/components/date-input";
import type { Employee, TimeEntry, CustomRole } from "@shared/schema";

interface EmployeeWorkday {
  employee: Employee;
  entries: TimeEntry[];
  clockIn: Date | null;
  clockOut: Date | null;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  unpaidBreakMinutes: number;
  netWorkedMinutes: number;
  status: "working" | "on-break" | "completed";
}

function processEntriesForEmployee(emp: Employee, dayEntries: TimeEntry[], paidBreakMinutes?: number | null): EmployeeWorkday[] {
  const sorted = [...dayEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const workdays: EmployeeWorkday[] = [];
  let currentWorkday: Partial<EmployeeWorkday> & { lastClockIn: Date | null; lastBreakStart: Date | null; onBreak: boolean } | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const ts = new Date(entry.timestamp);
    
    if (entry.type === "clock-in") {
      if (currentWorkday && !currentWorkday.clockOut) {
        let autoClose = false;
        const hoursElapsed = differenceInMinutes(ts, currentWorkday.lastClockIn!) / 60;
        
        if (hoursElapsed >= 24) {
          autoClose = true;
        } else if (hoursElapsed >= 15) {
          autoClose = true;
        }

        if (autoClose) {
          const finalized = finalizeWorkday(emp, currentWorkday as any, paidBreakMinutes);
          workdays.push(finalized);
          currentWorkday = null;
        } else {
          const finalized = finalizeWorkday(emp, currentWorkday as any, paidBreakMinutes);
          workdays.push(finalized);
        }
      }
      
      currentWorkday = {
        employee: emp,
        entries: [],
        clockIn: ts,
        clockOut: null,
        totalWorkedMinutes: 0,
        totalBreakMinutes: 0,
        status: "working",
        lastClockIn: ts,
        lastBreakStart: null,
        onBreak: false
      };
    }

    if (!currentWorkday) continue;
    currentWorkday.entries!.push(entry);

    switch (entry.type) {
      case "clock-out":
        currentWorkday.clockOut = ts;
        if (currentWorkday.lastClockIn) {
          currentWorkday.totalWorkedMinutes! += differenceInMinutes(ts, currentWorkday.lastClockIn);
          currentWorkday.lastClockIn = null;
        }
        currentWorkday.status = "completed";
        const finalized = finalizeWorkday(emp, currentWorkday as any, paidBreakMinutes);
        workdays.push(finalized);
        currentWorkday = null;
        break;
      case "break-start":
        currentWorkday.lastBreakStart = ts;
        currentWorkday.onBreak = true;
        currentWorkday.status = "on-break";
        if (currentWorkday.lastClockIn) {
          currentWorkday.totalWorkedMinutes! += differenceInMinutes(ts, currentWorkday.lastClockIn);
          currentWorkday.lastClockIn = null;
        }
        break;
      case "break-end":
        currentWorkday.onBreak = false;
        currentWorkday.status = "working";
        if (currentWorkday.lastBreakStart) {
          currentWorkday.totalBreakMinutes! += differenceInMinutes(ts, currentWorkday.lastBreakStart);
          currentWorkday.lastBreakStart = null;
        }
        currentWorkday.lastClockIn = ts;
        break;
    }
  }

  if (currentWorkday) {
    const hoursElapsed = differenceInMinutes(new Date(), currentWorkday.lastClockIn!) / 60;
    
    if (hoursElapsed >= 24) {
      currentWorkday.status = "completed"; 
    } else {
      if (currentWorkday.lastClockIn) {
        currentWorkday.totalWorkedMinutes! += differenceInMinutes(new Date(), currentWorkday.lastClockIn);
      }
      if (currentWorkday.lastBreakStart && currentWorkday.onBreak) {
        currentWorkday.totalBreakMinutes! += differenceInMinutes(new Date(), currentWorkday.lastBreakStart);
      }
    }
    workdays.push(finalizeWorkday(emp, currentWorkday as any, paidBreakMinutes));
  }

  return workdays.length > 0 ? workdays : [{
    employee: emp,
    entries: [],
    clockIn: null,
    clockOut: null,
    totalWorkedMinutes: 0,
    totalBreakMinutes: 0,
    unpaidBreakMinutes: 0,
    netWorkedMinutes: 0,
    status: "completed"
  }];
}

function finalizeWorkday(emp: Employee, wd: any, paidBreakMinutes?: number | null): EmployeeWorkday {
  const unpaidBreakMinutes = (paidBreakMinutes != null && paidBreakMinutes >= 0)
    ? Math.max(0, wd.totalBreakMinutes - paidBreakMinutes)
    : 0;
  const netWorkedMinutes = Math.max(0, wd.totalWorkedMinutes - unpaidBreakMinutes);
  
  return {
    employee: emp,
    entries: wd.entries,
    clockIn: wd.clockIn,
    clockOut: wd.clockOut,
    totalWorkedMinutes: wd.totalWorkedMinutes,
    totalBreakMinutes: wd.totalBreakMinutes,
    unpaidBreakMinutes,
    netWorkedMinutes,
    status: wd.status
  };
}

function buildWorkdaysForDate(
  entries: TimeEntry[],
  employees: Employee[],
  date: Date,
  selectedRole: string,
  employeeSearch: string,
  paidBreakMinutes?: number | null
): EmployeeWorkday[] {
  const dateStr = format(date, "yyyy-MM-dd");
  const empMap = new Map<number, Employee>();
  employees.forEach(e => empMap.set(e.id, e));

  const grouped = new Map<number, TimeEntry[]>();
  entries.forEach(entry => {
    const entryDateStr = typeof entry.date === "string" ? entry.date.substring(0, 10) : format(new Date(entry.date), "yyyy-MM-dd");
    if (entryDateStr !== dateStr) return;
    const list = grouped.get(entry.employeeId) || [];
    list.push(entry);
    grouped.set(entry.employeeId, list);
  });

  const workdays: EmployeeWorkday[] = [];
  grouped.forEach((dayEntries, employeeId) => {
    const emp = empMap.get(employeeId);
    if (!emp) return;
    if (selectedRole !== "all" && emp.role !== selectedRole) return;
    if (employeeSearch && !emp.name.toLowerCase().includes(employeeSearch.toLowerCase())) return;
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

function buildWorkdaysForRange(
  entries: TimeEntry[],
  employees: Employee[],
  startDate: Date,
  endDate: Date,
  selectedRole: string,
  employeeSearch: string,
  targetEmployeeIds: number[] | null = null,
  paidBreakMinutes?: number | null
): { date: Date; workdays: EmployeeWorkday[] }[] {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  return days
    .map(day => {
      let dayWorkdays = buildWorkdaysForDate(entries, employees, day, selectedRole, employeeSearch, paidBreakMinutes);
      if (targetEmployeeIds && targetEmployeeIds.length > 0) {
        dayWorkdays = dayWorkdays.filter(wd => targetEmployeeIds.includes(wd.employee.id));
      }
      return { date: day, workdays: dayWorkdays };
    })
    .filter(d => d.workdays.length > 0);
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
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editTime, setEditTime] = useState<string>("");
  const [editingShift, setEditingShift] = useState<EmployeeWorkday | null>(null);
  const [editShiftClockIn, setEditShiftClockIn] = useState<string>("");
  const [editShiftClockOut, setEditShiftClockOut] = useState<string>("");
  
  const [viewingDate, setViewingDate] = useState<Date | null>(null);
  const [addingTimesheet, setAddingTimesheet] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportSelectedEmployeeIds, setExportSelectedEmployeeIds] = useState<number[]>([]);
  const [exportStartDate, setExportStartDate] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [exportEndDate, setExportEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const { toast } = useToast();

  const weekEnd = useMemo(() => endOfWeek(selectedWeek, { weekStartsOn: 1 }), [selectedWeek]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: selectedWeek, end: weekEnd }), [selectedWeek, weekEnd]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  const { data: customRoles = [] } = useQuery<CustomRole[]>({ queryKey: ["/api/roles"] });
  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({ queryKey: ["/api/kiosk/entries"] });
  const { data: breakPolicy } = useQuery<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }>({ queryKey: ["/api/settings/break-policy"] });
  const paidBreakMinutes = breakPolicy?.paidBreakMinutes ?? null;

  const navigateWeek = (direction: number) => {
    const next = new Date(selectedWeek);
    next.setDate(next.getDate() + direction * 7);
    const newStart = startOfWeek(next, { weekStartsOn: 1 });
    setSelectedWeek(newStart);
    setSelectedDay(newStart);
  };

  const navigateMonth = (direction: number) => {
    const next = direction > 0 ? addMonths(selectedMonth, 1) : subMonths(selectedMonth, 1);
    setSelectedMonth(startOfMonth(next));
  };

  const workdays = useMemo(
    () => buildWorkdaysForDate(entries, employees, selectedDay, selectedRole, employeeSearch, paidBreakMinutes),
    [entries, employees, selectedDay, selectedRole, employeeSearch, paidBreakMinutes]
  );

  const monthWorkdays = useMemo(
    () => buildWorkdaysForRange(entries, employees, selectedMonth, monthEnd, selectedRole, employeeSearch, null, paidBreakMinutes),
    [entries, employees, selectedMonth, monthEnd, selectedRole, employeeSearch, paidBreakMinutes]
  );

  const [selectedWorkday, setSelectedWorkday] = useState<EmployeeWorkday | null>(null);

  const setViewingWorkdayManual = useCallback((wd: EmployeeWorkday, date: Date) => {
    setSelectedWorkday(wd);
    setViewingDate(date);
  }, []);

  const viewingWorkday = useMemo(() => {
    if (!selectedWorkday) return null;
    const dateToUse = viewingDate || selectedDay;
    const dayWorkdays = buildWorkdaysForDate(entries, employees, dateToUse, selectedRole, employeeSearch, paidBreakMinutes);
    return dayWorkdays.find(w => 
      w.employee.id === selectedWorkday.employee.id && 
      w.clockIn?.getTime() === selectedWorkday.clockIn?.getTime()
    ) || null;
  }, [selectedWorkday, viewingDate, entries, employees, selectedDay, selectedRole, employeeSearch, paidBreakMinutes]);

  const totalHours = useMemo(() => {
    if (viewMode === "week") return workdays.reduce((s, w) => s + w.netWorkedMinutes, 0);
    return monthWorkdays.reduce((s, d) => s + d.workdays.reduce((ss, w) => ss + w.netWorkedMinutes, 0), 0);
  }, [viewMode, workdays, monthWorkdays]);

  return (
    <div className="flex flex-col h-full bg-muted/20">
      <div className="flex flex-col gap-4 p-4 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Timesheets</h2>
          </div>
          <Button 
            size="sm" 
            className="font-bold shadow-sm gap-1.5 h-9"
            onClick={() => setAddingTimesheet(true)}
          >
            <Plus className="w-4 h-4" /> Add Timesheet
          </Button>
        </div>

        <div className="flex items-center justify-between bg-background rounded-lg border p-1 shadow-sm">
          <div className="flex bg-muted rounded-md p-1">
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all ${
                viewMode === "week" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode("month")}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all ${
                viewMode === "month" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Month
            </button>
          </div>
          
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 text-xs font-bold gap-1.5"
            onClick={() => setExportDialogOpen(true)}
          >
            <FileDown className="w-3.5 h-3.5" /> Export PDF
          </Button>
        </div>
        
        <div className="flex items-center justify-between bg-background rounded-lg border p-1 shadow-sm">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => viewMode === "week" ? navigateWeek(-1) : navigateMonth(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {viewMode === "week" ? "Selected Week" : "Selected Month"}
            </span>
            <span className="text-sm font-bold">
              {viewMode === "week" 
                ? `${format(selectedWeek, "MMM d")} - ${format(weekEnd, "MMM d")}`
                : format(selectedMonth, "MMMM yyyy")
              }
            </span>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => viewMode === "week" ? navigateWeek(1) : navigateMonth(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4 pb-24">
        <div className="flex flex-wrap gap-2">
          <div className="w-[140px]">
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="h-9 text-xs font-medium">
                <SelectValue placeholder="All Positions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Positions</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="employee">Employee</SelectItem>
                {customRoles.map(role => (
                  <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employees..."
                className="pl-9 h-9 text-xs"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {viewMode === "week" && (
          <div className="flex items-center gap-2 border rounded-lg p-1.5 bg-background shadow-sm overflow-x-auto hide-scrollbar">
            {weekDays.map((day) => {
              const today = isToday(day);
              const isSelected = isSameDay(day, selectedDay);
              const dayWorkdaysCount = buildWorkdaysForDate(entries, employees, day, selectedRole, employeeSearch, paidBreakMinutes).length;

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDay(day)}
                  className={`flex-1 min-w-[44px] flex flex-col items-center py-2 px-1 rounded-md transition-all ${
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : today
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "hover:bg-muted"
                  }`}
                >
                  <span className={`text-[10px] uppercase tracking-wider font-bold ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {format(day, "EEE")}
                  </span>
                  <span className="text-lg font-black leading-tight">
                    {format(day, "d")}
                  </span>
                  {dayWorkdaysCount > 0 && !isSelected && (
                    <div className="w-1 h-1 rounded-full bg-primary mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {entriesLoading || empsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {viewMode === "week" ? (
              workdays.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 italic gap-2">
                  <Calendar className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No entries for this day</p>
                </div>
              ) : (
                workdays.map((wd, i) => (
                  <WorkdayCard key={`${wd.employee.id}-${i}`} workday={wd} date={selectedDay} onSelect={setViewingWorkdayManual} />
                ))
              )
            ) : (
              monthWorkdays.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 italic gap-2">
                  <Calendar className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No entries for this month</p>
                </div>
              ) : (
                monthWorkdays.map(({ date, workdays: dayWds }) => (
                  <div key={date.toISOString()} className="space-y-2">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                      {format(date, "EEEE, MMM d")}
                    </h3>
                    {dayWds.map((wd, i) => (
                      <WorkdayCard key={`${wd.employee.id}-${i}`} workday={wd} date={date} onSelect={setViewingWorkdayManual} />
                    ))}
                  </div>
                ))
              )
            )}
          </div>
        )}
      </div>

      <div className="border-t bg-background sticky bottom-0 z-10 px-4 py-3 flex items-center justify-end gap-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <span className="text-sm text-muted-foreground">Total:</span>
        <span className="text-lg font-bold" data-testid="text-total-hours">{formatHoursDecimal(totalHours)} h</span>
      </div>

      {/* Rest of the dialogs and components should go here, maintaining the existing logic but fitting the new layout */}
    </div>
  );
}

function WorkdayCard({ workday, date, onSelect }: { workday: EmployeeWorkday, date: Date, onSelect: (wd: EmployeeWorkday, date: Date) => void }) {
  const { employee: emp, clockIn, clockOut, netWorkedMinutes, status } = workday;
  const sc = {
    working: { label: "Working", color: "text-emerald-600 bg-emerald-50" },
    "on-break": { label: "On Break", color: "text-amber-600 bg-amber-50" },
    completed: { label: "Completed", color: "text-blue-600 bg-blue-50" },
  }[status];

  return (
    <div 
      className="bg-card rounded-lg border shadow-sm p-3 hover-elevate cursor-pointer transition-all"
      onClick={() => onSelect(workday, date)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{emp.name}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {emp.role || "Loose Leaf"}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-black">{formatHoursDecimal(netWorkedMinutes)} h</div>
          <div className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${sc.color}`}>
            {sc.label}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t">
        <div className="flex-1">
          <div className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground mb-0.5">Clock In</div>
          <div className="text-xs font-mono font-bold">{clockIn ? format(clockIn, "HH:mm") : "—"}</div>
        </div>
        <div className="flex-1">
          <div className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground mb-0.5">Clock Out</div>
          <div className="text-xs font-mono font-bold">{clockOut ? format(clockOut, "HH:mm") : "—"}</div>
        </div>
        <div className="flex-1 text-right">
          <div className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground mb-0.5">Break</div>
          <div className="text-xs font-mono font-bold">{workday.totalBreakMinutes > 0 ? formatMinutes(workday.totalBreakMinutes) : "—"}</div>
        </div>
      </div>
    </div>
  );
}
