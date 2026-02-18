import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, startOfMonth, endOfMonth, addMonths, subMonths, isSameDay, parseISO, isToday } from "date-fns";
import type { Shift, Employee } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { ShiftFormDialog } from "@/components/shift-form-dialog";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { formatTime, getDaysBetween } from "@/lib/constants";

type ViewMode = "week" | "month";

export default function Schedule() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const { toast } = useToast();

  const dateRange = useMemo(() => {
    if (viewMode === "week") {
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 }),
      };
    }
    return {
      start: startOfMonth(currentDate),
      end: endOfMonth(currentDate),
    };
  }, [currentDate, viewMode]);

  const days = useMemo(() => getDaysBetween(dateRange.start, dateRange.end), [dateRange]);

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
    if (viewMode === "week") {
      setCurrentDate(direction > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
    } else {
      setCurrentDate(direction > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    }
  };

  const goToToday = () => setCurrentDate(new Date());

  const handleAddShift = (dateStr?: string) => {
    setEditingShift(null);
    setSelectedDate(dateStr);
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
      <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold" data-testid="text-schedule-title">Schedule</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 mr-2">
            <Button size="icon" variant="ghost" onClick={() => navigate(-1)} data-testid="button-prev-period">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center rounded-md border">
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-r-none ${viewMode === "week" ? "bg-muted" : ""}`}
                onClick={() => setViewMode("week")}
                data-testid="button-view-week"
              >
                Week
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-l-none ${viewMode === "month" ? "bg-muted" : ""}`}
                onClick={() => setViewMode("month")}
                data-testid="button-view-month"
              >
                Month
              </Button>
            </div>
            <Button size="icon" variant="ghost" onClick={() => navigate(1)} data-testid="button-next-period">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <span className="text-sm font-medium min-w-[160px] text-center" data-testid="text-date-range">
            {viewMode === "week"
              ? `${format(dateRange.start, "MMM d")} - ${format(dateRange.end, "MMM d, yyyy")}`
              : format(currentDate, "MMMM yyyy")}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: viewMode === "week" ? 7 : 35 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-md" />
            ))}
          </div>
        ) : viewMode === "week" ? (
          <WeekView
            days={days}
            shiftsByDate={shiftsByDate}
            employeeMap={employeeMap}
            onAddShift={handleAddShift}
            onEditShift={handleEditShift}
            onDeleteShift={(id) => deleteShift.mutate(id)}
          />
        ) : (
          <MonthView
            days={days}
            currentDate={currentDate}
            shiftsByDate={shiftsByDate}
            employeeMap={employeeMap}
            onAddShift={handleAddShift}
            onEditShift={handleEditShift}
            onDeleteShift={(id) => deleteShift.mutate(id)}
          />
        )}
      </div>

      <ShiftFormDialog
        open={shiftDialogOpen}
        onOpenChange={setShiftDialogOpen}
        shift={editingShift}
        defaultDate={selectedDate}
      />
    </div>
  );
}

interface CalendarViewProps {
  days: Date[];
  shiftsByDate: Map<string, Shift[]>;
  employeeMap: Map<number, Employee>;
  onAddShift: (dateStr: string) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (id: number) => void;
  currentDate?: Date;
}

function WeekView({ days, shiftsByDate, employeeMap, onAddShift, onEditShift, onDeleteShift }: CalendarViewProps) {
  const { isManager, isAdmin } = useAuth();
  const showHours = isManager || isAdmin;

  return (
    <div className="flex flex-col gap-4 h-full">
      {days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        const dayShifts = shiftsByDate.get(dateStr) || [];
        const today = isToday(day);

        const totalHours = dayShifts.reduce((acc, shift) => {
          const start = parseISO(`${shift.date}T${shift.startTime}`);
          const end = parseISO(`${shift.date}T${shift.endTime}`);
          let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
          if (diff < 0) diff += 24; // Handle overnight shifts
          return acc + diff;
        }, 0);

        return (
          <div
            key={dateStr}
            className={`flex flex-col rounded-lg border shadow-sm shrink-0 ${
              today ? "border-primary/50 bg-primary/[0.02]" : "bg-card"
            }`}
            data-testid={`calendar-day-${dateStr}`}
          >
            <div className="flex items-center justify-between p-3 border-b bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center justify-center min-w-[40px]">
                  <span className={`text-[10px] uppercase tracking-wider font-bold ${today ? "text-primary" : "text-muted-foreground"}`}>
                    {format(day, "EEE")}
                  </span>
                  <span
                    className={`text-lg font-black leading-none ${
                      today ? "text-primary" : ""
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </div>
                <div className="h-8 w-px bg-border" />
                {showHours && dayShifts.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] font-bold py-0 h-5">
                    {totalHours.toFixed(1)}h Total
                  </Badge>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[11px] font-bold border-dashed hover:border-primary/50 hover:bg-primary/[0.03] transition-colors gap-1.5"
                onClick={() => onAddShift(dateStr)}
                data-testid={`button-add-shift-${dateStr}`}
              >
                <Plus className="w-3.5 h-3.5" /> Add Shift
              </Button>
            </div>
            <div className="p-3">
              <div 
                className="flex gap-3 overflow-x-auto pb-2 snap-x hide-scrollbar cursor-grab active:cursor-grabbing select-none scroll-smooth"
                onMouseDown={(e) => {
                  const el = e.currentTarget;
                  const startX = e.pageX - el.offsetLeft;
                  const scrollLeft = el.scrollLeft;
                  let isDragging = false;

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const x = moveEvent.pageX - el.offsetLeft;
                    const walk = (x - startX) * 1.5;
                    if (Math.abs(walk) > 5) isDragging = true;
                    el.scrollLeft = scrollLeft - walk;
                  };

                  const handleMouseUp = () => {
                    window.removeEventListener('mousemove', handleMouseMove);
                    window.removeEventListener('mouseup', handleMouseUp);
                    if (isDragging) {
                      el.style.scrollSnapType = 'x mandatory';
                    }
                  };

                  el.style.scrollSnapType = 'none';
                  window.addEventListener('mousemove', handleMouseMove);
                  window.addEventListener('mouseup', handleMouseUp);
                }}
              >
                {dayShifts.map((shift) => {
                  const emp = employeeMap.get(shift.employeeId);
                  return (
                    <div key={shift.id} className="w-[200px] shrink-0 snap-start">
                      <ShiftCard
                        shift={shift}
                        employee={emp}
                        onEdit={onEditShift}
                        onDelete={onDeleteShift}
                        compact={false}
                      />
                    </div>
                  );
                })}
                {dayShifts.length === 0 && (
                  <button
                    onClick={() => onAddShift(dateStr)}
                    className="flex-1 min-h-[60px] flex items-center justify-center text-xs text-muted-foreground/40 italic border-2 border-dashed rounded-md hover:text-muted-foreground hover:bg-muted/30 transition-all w-full"
                  >
                    No shifts scheduled for this day
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ days, currentDate, shiftsByDate, employeeMap, onAddShift, onEditShift, onDeleteShift }: CalendarViewProps) {
  const { isManager, isAdmin } = useAuth();
  const showHours = isManager || isAdmin;
  const monthStart = startOfMonth(currentDate!);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthEnd = endOfMonth(currentDate!);
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calDays = getDaysBetween(calStart, calEnd);

  const dayHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="flex flex-col gap-1 min-w-[700px] sm:min-w-0">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayHeaders.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {calDays.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const dayShifts = shiftsByDate.get(dateStr) || [];
          const today = isToday(day);
          const isCurrentMonth = day.getMonth() === currentDate!.getMonth();

          const totalHours = dayShifts.reduce((acc, shift) => {
            const start = parseISO(`${shift.date}T${shift.startTime}`);
            const end = parseISO(`${shift.date}T${shift.endTime}`);
            let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            if (diff < 0) diff += 24;
            return acc + diff;
          }, 0);

          return (
            <div
              key={dateStr}
              className={`flex flex-col rounded-md border min-h-[100px] ${
                !isCurrentMonth ? "opacity-40" : ""
              } ${today ? "border-primary/50 bg-primary/[0.03]" : "bg-card"}`}
              data-testid={`calendar-month-day-${dateStr}`}
            >
              <div className="flex items-center justify-between px-2 py-1 flex-wrap gap-1">
                <span
                  className={`text-[10px] font-medium flex items-center justify-center w-5 h-5 rounded-full ${
                    today ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {format(day, "d")}
                </span>
                {isCurrentMonth && (
                  <Button
                    variant="ghost"
                    className="h-5 px-1 text-[8px] font-medium border border-dashed hover:border-primary/50 hover:bg-primary/[0.03] transition-colors"
                    onClick={() => onAddShift(dateStr)}
                  >
                    <Plus className="w-2 h-2 mr-0.5" /> Add
                  </Button>
                )}
              </div>
              <div 
                className="flex-1 px-1 pb-1 space-y-0.5 overflow-y-auto overflow-x-hidden hide-scrollbar max-h-[120px]"
              >
                {dayShifts.map((shift) => {
                  const emp = employeeMap.get(shift.employeeId);
                  return (
                    <ShiftCard
                      key={shift.id}
                      shift={shift}
                      employee={emp}
                      onEdit={onEditShift}
                      onDelete={onDeleteShift}
                      compact
                    />
                  );
                })}
              </div>
              {showHours && dayShifts.length > 0 && (
                <div className="px-1 py-0.5 border-t text-[9px] font-medium text-muted-foreground text-right">
                  {totalHours.toFixed(1)}h
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ShiftCardProps {
  shift: Shift;
  employee?: Employee;
  onEdit: (shift: Shift) => void;
  onDelete: (id: number) => void;
  compact: boolean;
}

function ShiftCard({ shift, employee, onEdit, onDelete, compact }: ShiftCardProps) {
  const bgColor = shift.color || employee?.color || "#3B82F6";

  if (compact) {
    return (
      <button
        onClick={() => onEdit(shift)}
        className="w-full text-left rounded px-1.5 py-0.5 text-[10px] font-medium text-white truncate cursor-pointer transition-opacity hover:opacity-90"
        style={{ backgroundColor: bgColor }}
        data-testid={`shift-compact-${shift.id}`}
      >
        {formatTime(shift.startTime)} {employee?.name?.split(" ")[0] || ""}
      </button>
    );
  }

  return (
    <div
      className="rounded-md px-2 py-1.5 text-white group relative cursor-pointer"
      style={{ backgroundColor: bgColor }}
      data-testid={`shift-card-${shift.id}`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] opacity-90">
            {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
          </div>
          {employee && (
            <div className="flex items-center gap-1 mt-0.5">
              <div className="w-3 h-3 rounded-full bg-white/30 flex items-center justify-center text-[7px] font-bold">
                {employee.name[0]}
              </div>
              <span className="text-[10px] opacity-90 truncate">{employee.name.split(" ")[0]}</span>
            </div>
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
  );
}
