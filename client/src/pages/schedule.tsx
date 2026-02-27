import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, parseISO, isToday } from "date-fns";
import type { Shift, Employee } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export default function Schedule() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const { toast } = useToast();

  const dateRange = useMemo(() => {
    return {
      start: startOfWeek(currentDate, { weekStartsOn: 1 }),
      end: endOfWeek(currentDate, { weekStartsOn: 1 }),
    };
  }, [currentDate]);

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
    setCurrentDate(direction > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
  };

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
      <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap relative">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold" data-testid="text-schedule-title">Schedule</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap absolute left-1/2 -translate-x-1/2">
          <Button size="icon" variant="ghost" onClick={() => navigate(-1)} data-testid="button-prev-period">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium min-w-[160px] text-center" data-testid="text-date-range">
            {format(dateRange.start, "MMM d")} - {format(dateRange.end, "MMM d, yyyy")}
          </span>
          <Button size="icon" variant="ghost" onClick={() => navigate(1)} data-testid="button-next-period">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="w-[100px] invisible md:visible"></div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-md" />
            ))}
          </div>
        ) : (
          <WeekView
            days={days}
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
}

function WeekView({ days, shiftsByDate, employeeMap, onAddShift, onEditShift, onDeleteShift }: CalendarViewProps) {
  const { isManager, isAdmin } = useAuth();
  const showHours = isManager || isAdmin;
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  useEffect(() => {
    const todayIdx = days.findIndex((d) => isToday(d));
    setSelectedDayIndex(todayIdx >= 0 ? todayIdx : 0);
  }, [days]);

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
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2 border rounded-lg p-1.5 bg-muted/30" data-testid="day-selector-bar">
        {days.map((day, idx) => {
          const today = isToday(day);
          const isSelected = idx === selectedDayIndex;
          const dateStr = format(day, "yyyy-MM-dd");
          const hasShifts = (shiftsByDate.get(dateStr) || []).length > 0;

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDayIndex(idx)}
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

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold" data-testid="text-selected-day">
            {format(selectedDay, "EEEE, MMM d")}
          </h3>
          {showHours && dayShifts.length > 0 && (
            <Badge variant="secondary" className="text-[10px] font-bold py-0 h-5">
              {totalHours.toFixed(1)}h Total
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] py-0 h-5">
            {dayShifts.length} shift{dayShifts.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-[11px] font-bold border-dashed gap-1.5"
          onClick={() => onAddShift(selectedDateStr)}
          data-testid={`button-add-shift-${selectedDateStr}`}
        >
          <Plus className="w-3.5 h-3.5" /> Add Shift
        </Button>
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
            return (
              <div
                key={empId}
                className="flex items-stretch gap-3 rounded-lg border bg-card shadow-sm"
                data-testid={`employee-row-${empId}`}
              >
                <div className="flex items-center gap-3 p-3 border-r bg-muted/20 min-w-[140px] shrink-0">
                  <EmployeeAvatar name={emp?.name || "?"} color={emp?.color || "#3B82F6"} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{emp?.name || "Unknown"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {empShifts.length} shift{empShifts.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <div 
                  className="flex gap-3 items-center overflow-x-auto py-3 pr-3 hide-scrollbar cursor-grab active:cursor-grabbing select-none flex-1"
                  onMouseDown={(e) => {
                    const el = e.currentTarget;
                    const startX = e.pageX - el.offsetLeft;
                    const scrollLeft = el.scrollLeft;

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      const x = moveEvent.pageX - el.offsetLeft;
                      const walk = (x - startX) * 1.5;
                      el.scrollLeft = scrollLeft - walk;
                    };

                    const handleMouseUp = () => {
                      window.removeEventListener('mousemove', handleMouseMove);
                      window.removeEventListener('mouseup', handleMouseUp);
                    };

                    window.addEventListener('mousemove', handleMouseMove);
                    window.addEventListener('mouseup', handleMouseUp);
                  }}
                >
                  {empShifts.map((shift) => (
                    <div key={shift.id} className="w-[180px] shrink-0">
                      <ShiftCard
                        shift={shift}
                        employee={emp}
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
  onEdit: (shift: Shift) => void;
  onDelete: (id: number) => void;
}

function ShiftCard({ shift, employee, onEdit, onDelete }: ShiftCardProps) {
  const bgColor = shift.color || (employee?.role ? employee.color : "#9CA3AF") || "#9CA3AF";

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
