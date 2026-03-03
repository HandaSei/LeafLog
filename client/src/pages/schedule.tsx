import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, parseISO, isToday, differenceInMinutes, isSameWeek, differenceInCalendarWeeks } from "date-fns";
import type { Shift, Employee, CustomRole } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useAuth } from "@/lib/auth";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, MoreHorizontal, Pencil, Trash2, StickyNote } from "lucide-react";
import { ShiftFormDialog } from "@/components/shift-form-dialog";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { formatTime, getDaysBetween } from "@/lib/constants";

export default function Schedule() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const { toast } = useToast();

  const isCurrentWeek = isSameWeek(currentDate, new Date(), { weekStartsOn: 1 });
  const weekLabel = useMemo(() => {
    const diff = differenceInCalendarWeeks(currentDate, new Date(), { weekStartsOn: 1 });
    if (diff === 0) return "This Week";
    if (diff === 1) return "Next Week";
    if (diff === -1) return "Last Week";
    if (diff > 0) return `In ${diff} weeks`;
    return `${Math.abs(diff)} weeks ago`;
  }, [currentDate]);

  const dateRange = useMemo(() => {
    return {
      start: startOfWeek(currentDate, { weekStartsOn: 1 }),
      end: endOfWeek(currentDate, { weekStartsOn: 1 }),
    };
  }, [currentDate]);

  const days = useMemo(() => getDaysBetween(dateRange.start, dateRange.end), [dateRange]);

  useEffect(() => {
    const todayIdx = days.findIndex((d) => isToday(d));
    setSelectedDayIndex(todayIdx >= 0 ? todayIdx : 0);
  }, [days]);

  const selectedDay = days[selectedDayIndex];
  const selectedDateStr = format(selectedDay, "yyyy-MM-dd");

  const { data: shifts = [], isLoading: shiftsLoading } = useQuery<Shift[]>({
    queryKey: ["/api/shifts"],
  });

  const { data: employees = [], isLoading: employeesLoading } = useQuery<Employee[]>({
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

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((s) => {
      const key = s.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [shifts]);

  const navigate = (direction: number) => {
    setCurrentDate(direction > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
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
            className="font-bold shadow-sm gap-1.5 px-4 h-9 bg-primary hover:bg-primary/90"
            onClick={() => handleAddShift(selectedDateStr)}
            data-testid={`button-add-shift-header`}
          >
            <Plus className="w-4 h-4" /> Add Shift
          </Button>
        </div>
        
        <div className="flex items-center justify-between bg-background rounded-lg border p-1 shadow-sm">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(-1)} data-testid="button-prev-period">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{weekLabel}</span>
            <span className="text-sm font-bold" data-testid="text-date-range">
              {format(days[0], "MMM d")} – {format(days[6], "MMM d, yyyy")}
            </span>
            {!isCurrentWeek && (
              <button
                onClick={() => setCurrentDate(new Date())}
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

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4">
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-md" />
              ))}
            </div>
          </div>
        ) : (
          <WeekView
            days={days}
            shiftsByDate={shiftsByDate}
            employeeMap={employeeMap}
            selectedDayIndex={selectedDayIndex}
            onSelectDayIndex={setSelectedDayIndex}
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

  return (
    <div className="flex flex-col gap-4 h-full pb-20 px-4 pt-4">
      <div className="flex items-center gap-2 border rounded-lg p-1.5 bg-muted/30" data-testid="day-selector-bar">
        {days.map((day, idx) => {
          const today = isToday(day);
          const isSelected = idx === selectedDayIndex;
          const dateStr = format(day, "yyyy-MM-dd");
          const hasShifts = (shiftsByDate.get(dateStr) || []).length > 0;

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDayIndex(idx)}
              className={`flex-1 flex flex-col items-center py-2 px-1 rounded-md transition-colors ${
                isSelected
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : today
                    ? "bg-primary/10 text-primary hover-elevate"
                    : "hover-elevate"
              }`}
              data-testid={`day-tab-${dateStr}`}
            >
              <span className={`text-[10px] uppercase tracking-wider font-bold ${isSelected ? "text-primary-foreground/80" : ""}`}>
                {format(day, "EEE")}
              </span>
              <span className="text-lg font-black leading-tight">
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
            <Badge variant="outline" className="text-[9px] px-1.5 h-4">
              {dayShifts.length}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto hide-scrollbar">
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
            
            return (
              <div
                key={empId}
                className="flex flex-col gap-2 rounded-lg border bg-card shadow-sm p-3"
                data-testid={`employee-row-${empId}`}
              >
                <div className="flex items-center justify-between gap-3 border-b pb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <EmployeeAvatar name={emp?.name || "?"} color={emp?.color || "#3B82F6"} size="sm" />
                    <div className="text-sm font-semibold truncate">{emp?.name || "Unknown"}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {empShifts.length} shift{empShifts.length !== 1 ? "s" : ""}
                    </div>
                    {showHours && empShifts.length > 0 && (
                      <>
                        <div className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                        <div className="text-[10px] font-semibold text-primary whitespace-nowrap">{empDurationLabel}</div>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {empShifts.map((shift) => (
                    <div key={shift.id} className="flex-1 min-w-[140px] max-w-[200px]">
                      <ShiftCard
                        shift={shift}
                        employee={emp}
                        customRoles={customRoles}
                        showEmployee={false}
                        onEdit={onEditShift}
                        onDelete={onDeleteShift}
                      />
                    </div>
                  ))}
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
