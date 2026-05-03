import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, parseISO, isToday, differenceInMinutes, isSameWeek, differenceInCalendarWeeks } from "date-fns";
import type { Shift, Employee, CustomRole } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, MoreHorizontal, Pencil, Trash2, StickyNote, FileDown } from "lucide-react";
import { ShiftFormDialog } from "@/components/shift-form-dialog";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { formatTime, getDaysBetween } from "@/lib/constants";
import { isActiveUnarchivedEmployee } from "@/lib/employees";
import { calculateDayPay, formatCurrency, hasPayConfig } from "@/lib/pay-utils";
import { exportSchedulePDF } from "@/lib/reports/schedule-pdf";
import { useToday } from "@/hooks/use-today";

const WEEK_OPTIONS = { weekStartsOn: 1 as const };

function toDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getDefaultDateKeyForWeek(dateInWeek: Date, today: Date) {
  const start = startOfWeek(dateInWeek, WEEK_OPTIONS);
  const end = endOfWeek(dateInWeek, WEEK_OPTIONS);
  const days = getDaysBetween(start, end);
  const todayKey = toDateKey(today);
  return days.some((day) => toDateKey(day) === todayKey) ? todayKey : toDateKey(start);
}

export default function Schedule() {
  const today = useToday();
  const todayKey = toDateKey(today);
  const previousTodayKeyRef = useRef(todayKey);
  const [currentDate, setCurrentDate] = useState(() => today);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [selectedDateKey, setSelectedDateKey] = useState(() => todayKey);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const { toast } = useToast();

  const isCurrentWeek = isSameWeek(currentDate, today, WEEK_OPTIONS);
  const weekLabel = useMemo(() => {
    const diff = differenceInCalendarWeeks(currentDate, today, WEEK_OPTIONS);
    if (diff === 0) return "This Week";
    if (diff === 1) return "Next Week";
    if (diff === -1) return "Last Week";
    if (diff > 0) return `In ${diff} weeks`;
    return `${Math.abs(diff)} weeks ago`;
  }, [currentDate, today]);

  const dateRange = useMemo(() => {
    return {
      start: startOfWeek(currentDate, WEEK_OPTIONS),
      end: endOfWeek(currentDate, WEEK_OPTIONS),
    };
  }, [currentDate]);

  const days = useMemo(() => getDaysBetween(dateRange.start, dateRange.end), [dateRange]);
  const shiftsFrom = format(dateRange.start, "yyyy-MM-dd");
  const shiftsTo = format(dateRange.end, "yyyy-MM-dd");

  const selectedDayIndex = useMemo(() => {
    const selectedIdx = days.findIndex((day) => toDateKey(day) === selectedDateKey);
    if (selectedIdx >= 0) return selectedIdx;

    const fallbackKey = getDefaultDateKeyForWeek(currentDate, today);
    const fallbackIdx = days.findIndex((day) => toDateKey(day) === fallbackKey);
    return fallbackIdx >= 0 ? fallbackIdx : 0;
  }, [currentDate, days, selectedDateKey, today]);

  useEffect(() => {
    const previousTodayKey = previousTodayKeyRef.current;
    if (previousTodayKey === todayKey) return;

    const previousToday = parseISO(previousTodayKey);
    if (isSameWeek(currentDate, previousToday, WEEK_OPTIONS)) {
      setCurrentDate(today);
    }
    setSelectedDateKey((current) => current === previousTodayKey ? todayKey : current);
    previousTodayKeyRef.current = todayKey;
  }, [currentDate, today, todayKey]);

  const selectedDay = days[selectedDayIndex];
  const selectedDateStr = format(selectedDay, "yyyy-MM-dd");

  const { data: shifts = [], isLoading: shiftsLoading, isFetching: shiftsFetching } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", "range", shiftsFrom, shiftsTo],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/shifts?from=${shiftsFrom}&to=${shiftsTo}`);
      return res.json();
    },
  });

  const { data: employees = [], isLoading: employeesLoading, isFetching: employeesFetching } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const deleteShift = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/shifts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Shift deleted", description: "The shift has been removed." });
      setPendingDeleteId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setPendingDeleteId(null);
    },
  });

  const visibleEmployees = useMemo(
    () => employees.filter(isActiveUnarchivedEmployee),
    [employees]
  );

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    visibleEmployees.forEach((e) => map.set(e.id, e));
    return map;
  }, [visibleEmployees]);

  const visibleShifts = useMemo(
    () => shifts.filter((s) => employeeMap.has(s.employeeId)),
    [shifts, employeeMap]
  );

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    visibleShifts.forEach((s) => {
      const key = s.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [visibleShifts]);

  const navigate = (direction: number) => {
    const nextDate = direction > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1);
    setCurrentDate(nextDate);
    setSelectedDateKey(getDefaultDateKeyForWeek(nextDate, today));
  };

  const handleAddShift = (dateStr?: string) => {
    setEditingShift(null);
    setSelectedDate(dateStr || selectedDateStr);
    setShiftDialogOpen(true);
  };

  const handleEditShift = (shift: Shift) => {
    setEditingShift(shift);
    setSelectedDate(undefined);
    setShiftDialogOpen(true);
  };

  const isLoading = shiftsLoading || employeesLoading;
  const isUpdating = !isLoading && (shiftsFetching || employeesFetching);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col gap-4 p-4 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight" data-testid="text-schedule-title">Schedule</h2>
          </div>
          <Button
            variant="default"
            size="sm"
            className="font-bold shadow-sm gap-1.5 px-4 h-9 bg-primary"
            onClick={() => handleAddShift(selectedDateStr)}
            data-testid={`button-add-shift-header`}
          >
            <Plus className="w-4 h-4" /> Add Shift
          </Button>
        </div>

        <div className="flex flex-col gap-3 bg-background rounded-lg border p-3 shadow-sm">
          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs font-semibold gap-1.5"
              onClick={() => setPdfDialogOpen(true)}
              data-testid="button-schedule-pdf"
            >
              <FileDown className="w-3.5 h-3.5" /> Export PDF
            </Button>
          </div>
          <div className="flex items-center justify-between border-t pt-2 mt-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(-1)} data-testid="button-prev-period">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{weekLabel}</span>
              <span className="text-sm font-bold" data-testid="text-date-range">
                {format(days[0], "MMM d")} – {format(days[6], "MMM d, yyyy")}
              </span>
              {!isCurrentWeek && (
                <button
                  onClick={() => {
                    setCurrentDate(today);
                    setSelectedDateKey(todayKey);
                  }}
                  className="text-[10px] text-primary hover:underline font-medium"
                  data-testid="button-today"
                >
                  → Today
                </button>
              )}
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(1)} data-testid="button-next-period">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-scroll custom-scrollbar scrollbar-gutter-stable">
        {isUpdating && (
          <div className="border-b px-4 py-1 text-[11px] text-muted-foreground">
            Updating schedule...
          </div>
        )}
        {isLoading ? (
          <div className="flex min-h-[220px] items-center justify-center px-4 text-sm text-muted-foreground">
            Loading schedule...
          </div>
        ) : (
          <WeekView
            days={days}
            shiftsByDate={shiftsByDate}
            employeeMap={employeeMap}
            selectedDayIndex={selectedDayIndex}
            onSelectDayIndex={(idx) => setSelectedDateKey(toDateKey(days[idx]))}
            onAddShift={handleAddShift}
            onEditShift={handleEditShift}
            onDeleteShift={(id) => setPendingDeleteId(id)}
          />
        )}
      </div>

      <ShiftFormDialog
        open={shiftDialogOpen}
        onOpenChange={setShiftDialogOpen}
        shift={editingShift}
        defaultDate={selectedDate}
      />

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shift?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the shift. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (pendingDeleteId !== null) deleteShift.mutate(pendingDeleteId); }}
              disabled={deleteShift.isPending}
              data-testid="button-confirm-delete-shift"
            >
              {deleteShift.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SchedulePdfDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        shifts={visibleShifts}
        employees={visibleEmployees}
        defaultStart={dateRange.start}
        defaultEnd={dateRange.end}
      />
    </div>
  );
}

interface CalendarViewProps {
  days: Date[];
  shiftsByDate: Map<string, Shift[]>;
  employeeMap: Map<number, Employee>;
  selectedDayIndex: number;
  onSelectDayIndex: (idx: number) => void;
  onAddShift: (dateStr: string) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (id: number) => void;
}

function WeekView({ days, shiftsByDate, employeeMap, selectedDayIndex, onSelectDayIndex, onAddShift, onEditShift, onDeleteShift }: CalendarViewProps) {
  const { isManager, isAdmin } = useAuth();
  const showHours = isManager || isAdmin;
  const { data: customRoles = [] } = useQuery<CustomRole[]>({ queryKey: ["/api/roles"] });

  const selectedDay = days[selectedDayIndex];
  const selectedDateStr = format(selectedDay, "yyyy-MM-dd");
  const dayShifts = shiftsByDate.get(selectedDateStr) || [];

  const shiftsByEmployee = useMemo(() => {
    const map = new Map<number, Shift[]>();
    dayShifts.forEach((s) => {
      if (!map.has(s.employeeId)) map.set(s.employeeId, []);
      map.get(s.employeeId)!.push(s);
    });
    return map;
  }, [dayShifts]);

  const totalHours = dayShifts.reduce((acc, shift) => {
    const start = parseISO(`${shift.date}T${shift.startTime}`);
    const end = parseISO(`${shift.date}T${shift.endTime}`);
    let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (diff < 0) diff += 24;
    return acc + diff;
  }, 0);

  const dayTotalPay = useMemo(() => {
    let total = 0;
    shiftsByEmployee.forEach((empShifts, empId) => {
      const emp = employeeMap.get(empId);
      if (!emp || !hasPayConfig(emp)) return;
      const mins = empShifts.reduce((acc, s) => {
        const start = parseISO(`${s.date}T${s.startTime}`);
        const end = parseISO(`${s.date}T${s.endTime}`);
        let diff = differenceInMinutes(end, start);
        if (diff < 0) diff += 1440;
        return acc + diff;
      }, 0);
      total += calculateDayPay(emp, selectedDateStr, mins / 60, 0);
    });
    return total;
  }, [shiftsByEmployee, employeeMap, selectedDateStr]);

  return (
    <div className="flex min-h-full flex-col gap-4 pb-20 px-4 pt-4">
      <div className="grid grid-cols-7 gap-1.5" data-testid="day-selector-bar">
        {days.map((day, idx) => {
          const today = isToday(day);
          const isSelected = idx === selectedDayIndex;
          const dateStr = format(day, "yyyy-MM-dd");
          const hasShifts = (shiftsByDate.get(dateStr) || []).length > 0;

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDayIndex(idx)}
              className={`flex flex-col items-center justify-center py-2 rounded-xl transition-all ${
                isSelected
                  ? "bg-primary text-primary-foreground shadow-md scale-105"
                  : today
                    ? "bg-primary/10"
                    : "bg-muted/50 hover:bg-muted"
              }`}
              data-testid={`day-tab-${dateStr}`}
            >
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                {format(day, "EEE")}
              </span>
              <span className="text-lg font-black">
                {format(day, "d")}
              </span>
              {hasShifts && !isSelected && (
                <div className="w-1 h-1 rounded-full bg-primary mt-0.5" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 overflow-hidden">
          <h3 className="text-sm font-bold truncate" data-testid="text-selected-day">
            {format(selectedDay, "EEEE, MMM d")}
          </h3>
          <div className="flex gap-1 shrink-0">
            {showHours && dayShifts.length > 0 && (
              <Badge variant="secondary" className="text-[9px] font-bold px-1.5 h-4">
                {totalHours.toFixed(1)}h
              </Badge>
            )}
            {showHours && dayTotalPay > 0 && (
              <Badge variant="outline" className="text-[9px] font-bold px-1.5 h-4" data-testid="text-day-total-pay">
                {formatCurrency(dayTotalPay)}
              </Badge>
            )}
            <Badge variant="outline" className="text-[9px] px-1.5 h-4">
              {dayShifts.length}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {dayShifts.length === 0 ? (
          <button
            onClick={() => onAddShift(selectedDateStr)}
            className="flex-1 min-h-[120px] flex flex-col items-center justify-center text-sm text-muted-foreground/40 italic border-2 border-dashed rounded-lg hover-elevate gap-2"
            data-testid="empty-day-placeholder"
          >
            <Plus className="w-5 h-5" />
            No shifts scheduled for this day
          </button>
        ) : (
          Array.from(shiftsByEmployee.entries()).map(([empId, empShifts]) => {
            const emp = employeeMap.get(empId);
            const empTotalMins = empShifts.reduce((acc, s) => {
              const start = parseISO(`${s.date}T${s.startTime}`);
              const end = parseISO(`${s.date}T${s.endTime}`);
              let diff = differenceInMinutes(end, start);
              if (diff < 0) diff += 1440;
              return acc + diff;
            }, 0);
            const empH = Math.floor(empTotalMins / 60);
            const empM = empTotalMins % 60;
            const empDurationLabel = empM === 0 ? `${empH}h total` : `${empH}h ${empM}m total`;
            const empPay = emp && hasPayConfig(emp) ? calculateDayPay(emp, selectedDateStr, empTotalMins / 60, 0) : 0;
            
            return (
              <div
                key={empId}
                className="w-full flex items-center gap-3 p-3 rounded-md border bg-card"
                data-testid={`employee-row-${empId}`}
              >
                <EmployeeAvatar name={emp?.name || "?"} color={emp?.color || "#3B82F6"} size="sm" />
                <div className="flex-1 min-w-0 overflow-x-auto custom-scrollbar pb-1">
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0 border-r pr-3 min-w-[80px]">
                      <span className="text-xs font-semibold truncate block">{emp?.name || "Unknown"}</span>
                      <span className="text-[10px] text-muted-foreground">{emp?.role || "No Role"}</span>
                    </div>
                    <div className="flex items-center gap-4 flex-nowrap">
                      {empShifts.map((shift, idx) => {
                        const dur = shiftDuration(shift.startTime, shift.endTime);
                        const roleColor = shift.role
                          ? (customRoles.find(r => r.name === shift.role)?.color || shift.color || emp?.color)
                          : (emp?.color || "#9CA3AF");
                        return (
                          <div key={shift.id} className={`flex items-center gap-2 flex-shrink-0 group ${idx > 0 ? "border-l pl-4" : ""}`}>
                            <div className="flex flex-col items-center">
                              <div className="w-1.5 h-1.5 rounded-full mb-1" style={{ backgroundColor: roleColor || "#9CA3AF" }} />
                              <span className="text-xs font-bold whitespace-nowrap">
                                {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                              </span>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {dur}{shift.role ? ` • ${shift.role}` : ""}
                              </span>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-all"
                                  data-testid={`button-shift-menu-${shift.id}`}
                                >
                                  <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onEditShift(shift)} data-testid={`button-edit-shift-${shift.id}`}>
                                  <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => onDeleteShift(shift.id)}
                                  className="text-destructive focus:text-destructive"
                                  data-testid={`button-delete-shift-${shift.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                    </div>
                    <span className="text-xs font-bold text-muted-foreground ml-auto flex-shrink-0 pl-2">
                      {empH > 0 || empM > 0 ? (empM === 0 ? `${empH}h` : `${empH}h ${empM}m`) : ""}
                      {showHours && empPay > 0 && (
                        <span className="ml-2 text-[10px] font-semibold text-muted-foreground" data-testid={`text-emp-pay-${empId}`}>{formatCurrency(empPay)}</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface ShiftCardProps {
  shift: Shift;
  employee?: Employee;
  customRoles?: CustomRole[];
  showEmployee?: boolean;
  onEdit: (shift: Shift) => void;
  onDelete: (id: number) => void;
}

function shiftDuration(startTime: string, endTime: string): string {
  const start = parseISO(`2000-01-01T${startTime}`);
  const end = parseISO(`2000-01-01T${endTime}`);
  let mins = differenceInMinutes(end, start);
  if (mins < 0) mins += 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function ShiftCard({ shift, employee, customRoles = [], showEmployee = true, onEdit, onDelete }: ShiftCardProps) {
  const bgColor = (shift.role ? (customRoles.find(r => r.name === shift.role)?.color || shift.color || employee?.color) : (employee?.color || "#9CA3AF")) || "#9CA3AF";
  const duration = shiftDuration(shift.startTime, shift.endTime);
  const isOvernight = shift.endTime < shift.startTime;

  return (
    <TooltipProvider>
      <div
        className="rounded-md px-2 py-1.5 text-white group relative cursor-pointer"
        style={{ backgroundColor: bgColor }}
        data-testid={`shift-card-${shift.id}`}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] opacity-90">
              {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
            </div>
            <div className="text-[10px] font-bold opacity-80">{duration}{shift.role && ` • ${shift.role}`}</div>
            {showEmployee && employee && (
              <div className="flex items-center gap-1 mt-0.5">
                <div className="w-3 h-3 rounded-full bg-white/30 flex items-center justify-center text-[7px] font-bold">
                  {employee.name[0]}
                </div>
                <span className="text-[10px] opacity-90 truncate">{employee.name.split(" ")[0]}</span>
              </div>
            )}
            {shift.notes && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5 mt-0.5 opacity-80 cursor-default">
                    <StickyNote className="w-2.5 h-2.5" />
                    <span className="text-[9px] truncate max-w-[100px]">{shift.notes}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px] text-xs whitespace-pre-wrap">
                  {shift.notes}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="invisible group-hover:visible p-0.5 rounded hover:bg-white/20 transition-colors"
                data-testid={`button-shift-menu-${shift.id}`}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(shift)} data-testid={`button-edit-shift-${shift.id}`}>
                <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(shift.id)}
                className="text-destructive"
                data-testid={`button-delete-shift-${shift.id}`}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}

function calcShiftDurationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  return mins;
}

function formatDurationFromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

interface SchedulePdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: Shift[];
  employees: Employee[];
  defaultStart: Date;
  defaultEnd: Date;
}

function SchedulePdfDialog({ open, onOpenChange, shifts, employees, defaultStart, defaultEnd }: SchedulePdfDialogProps) {
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<number>>(new Set());
  const [periodMode, setPeriodMode] = useState<"week" | "custom">("week");
  const [customStart, setCustomStart] = useState(format(defaultStart, "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(defaultEnd, "yyyy-MM-dd"));
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const { data: customRoles = [] } = useQuery<CustomRole[]>({ queryKey: ["/api/roles"] });

  useEffect(() => {
    if (open) {
      setSelectedEmployeeIds(new Set());
      setPeriodMode("week");
      setCustomStart(format(defaultStart, "yyyy-MM-dd"));
      setCustomEnd(format(defaultEnd, "yyyy-MM-dd"));
    }
  }, [open, defaultStart, defaultEnd]);

  const activeEmployees = useMemo(() =>
    employees.filter(isActiveUnarchivedEmployee).sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  const toggleEmployee = (id: number) => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedEmployeeIds.size === activeEmployees.length) {
      setSelectedEmployeeIds(new Set());
    } else {
      setSelectedEmployeeIds(new Set(activeEmployees.map(e => e.id)));
    }
  };

  const handleExport = async () => {
    const targetIds = Array.from(selectedEmployeeIds);
    if (targetIds.length === 0) {
      toast({ title: "No employees selected", description: "Select at least one employee to export.", variant: "destructive" });
      return;
    }

    setIsExporting(true);
    try {
      const rangeStart = periodMode === "week" ? defaultStart : parseISO(customStart);
      const rangeEnd = periodMode === "week" ? defaultEnd : parseISO(customEnd);

      if (rangeEnd < rangeStart) {
        toast({ title: "Invalid date range", description: "End date must be after start date.", variant: "destructive" });
        setIsExporting(false);
        return;
      }

      const rangeFrom = format(rangeStart, "yyyy-MM-dd");
      const rangeTo = format(rangeEnd, "yyyy-MM-dd");
      const res = await apiRequest("GET", `/api/shifts?from=${rangeFrom}&to=${rangeTo}`);
      const shiftsForExport = await res.json();

      await exportSchedulePDF(rangeStart, rangeEnd, shiftsForExport, employees, targetIds, customRoles);
      onOpenChange(false);
      toast({ title: "PDF downloaded", description: "Schedule PDF has been saved." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message || "Failed to generate PDF.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Download Schedule PDF
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium tracking-wide">Experimental</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-semibold">Period</Label>
            <div className="flex gap-2">
              <Button
                variant={periodMode === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriodMode("week")}
                data-testid="button-period-week"
              >
                Current Week
              </Button>
              <Button
                variant={periodMode === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriodMode("custom")}
                data-testid="button-period-custom"
              >
                Custom Range
              </Button>
            </div>
            {periodMode === "week" && (
              <p className="text-xs text-muted-foreground">
                {format(defaultStart, "MMM d")} - {format(defaultEnd, "MMM d, yyyy")}
              </p>
            )}
            {periodMode === "custom" && (
              <div className="flex gap-2 items-center">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  data-testid="input-pdf-start-date"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  data-testid="input-pdf-end-date"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Employees</Label>
              <button
                onClick={toggleAll}
                className="text-xs text-primary font-medium"
                data-testid="button-toggle-all-employees"
              >
                {selectedEmployeeIds.size === activeEmployees.length ? "Deselect All" : "Select All"}
              </button>
            </div>
            <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto border rounded-md p-2">
              {activeEmployees.map(emp => (
                <label
                  key={emp.id}
                  className="flex items-center gap-2 py-1 px-1 rounded hover-elevate cursor-pointer"
                  data-testid={`checkbox-employee-${emp.id}`}
                >
                  <Checkbox
                    checked={selectedEmployeeIds.has(emp.id)}
                    onCheckedChange={() => toggleEmployee(emp.id)}
                  />
                  <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />
                  <span className="text-sm truncate">{emp.name}</span>
                  {emp.role && emp.role !== "No Role" && (
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">{emp.role}</span>
                  )}
                </label>
              ))}
              {activeEmployees.length === 0 && (
                <p className="text-sm text-muted-foreground italic py-2 text-center">No active employees</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedEmployeeIds.size} of {activeEmployees.length} selected
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-pdf">
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || selectedEmployeeIds.size === 0}
            data-testid="button-download-pdf"
          >
            <FileDown className="w-4 h-4 mr-2" />
            {isExporting ? "Generating..." : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
