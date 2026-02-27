import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isSameDay,
  differenceInMinutes, startOfMonth, endOfMonth, addMonths, subMonths,
} from "date-fns";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Edit2, Plus, Coffee, Search, FileDown, Calendar, CalendarDays, Check } from "lucide-react";
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

function processEntriesForEmployee(emp: Employee, dayEntries: TimeEntry[], paidBreakMinutes?: number | null): EmployeeWorkday {
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
        if (lastClockIn) { totalWorkedMinutes += differenceInMinutes(ts, lastClockIn); lastClockIn = null; }
        break;
      case "break-start":
        lastBreakStart = ts;
        onBreak = true;
        if (lastClockIn) { totalWorkedMinutes += differenceInMinutes(ts, lastClockIn); lastClockIn = null; }
        break;
      case "break-end":
        onBreak = false;
        if (lastBreakStart) { totalBreakMinutes += differenceInMinutes(ts, lastBreakStart); lastBreakStart = null; }
        lastClockIn = ts;
        break;
    }
  }

  if (lastClockIn && !clockOut) totalWorkedMinutes += differenceInMinutes(new Date(), lastClockIn);
  if (lastBreakStart && onBreak) totalBreakMinutes += differenceInMinutes(new Date(), lastBreakStart);

  if (clockOut) status = "completed";
  else if (onBreak) status = "on-break";

  const unpaidBreakMinutes = (paidBreakMinutes != null && paidBreakMinutes >= 0)
    ? Math.max(0, totalBreakMinutes - paidBreakMinutes)
    : 0;
  const netWorkedMinutes = Math.max(0, totalWorkedMinutes - unpaidBreakMinutes);

  return { employee: emp, entries: sorted, clockIn, clockOut, totalWorkedMinutes, totalBreakMinutes, unpaidBreakMinutes, netWorkedMinutes, status };
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
    workdays.push(processEntriesForEmployee(emp, dayEntries, paidBreakMinutes));
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

async function exportPDF(
  rangeStart: Date,
  rangeEnd: Date,
  rangeLabel: string,
  entries: TimeEntry[],
  employees: Employee[],
  targetEmployeeIds: number[],
  paidBreakMinutes?: number | null
) {
  const jspdf = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const jsPDF = jspdf.jsPDF;

  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Timesheet Report", 14, 16);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(rangeLabel, 14, 24);
  if (paidBreakMinutes != null && paidBreakMinutes > 0) {
    doc.setFontSize(9);
    doc.setTextColor(120, 100, 50);
    doc.text(`Break policy: ${paidBreakMinutes} min paid break. Any excess deducted from worked hours.`, 14, 29);
    doc.setTextColor(0, 0, 0);
  }

  const grouped = buildWorkdaysForRange(entries, employees, rangeStart, rangeEnd, "all", "", targetEmployeeIds, paidBreakMinutes);

  const hasUnpaid = grouped.some(({ workdays }) => workdays.some(wd => wd.unpaidBreakMinutes > 0));

  const rows: (string | number)[][] = [];
  let grandTotal = 0;

  grouped.forEach(({ date, workdays }) => {
    workdays.forEach(wd => {
      const { employee: emp, clockIn, clockOut, netWorkedMinutes, totalBreakMinutes, unpaidBreakMinutes } = wd;
      grandTotal += netWorkedMinutes;
      const row: (string | number)[] = [
        format(date, "EEE, MMM d, yyyy"),
        emp.name,
        emp.role || "Loose Leaf",
        clockIn ? format(clockIn, "HH:mm") : "—",
        clockOut ? format(clockOut, "HH:mm") : "—",
        totalBreakMinutes > 0 ? formatMinutes(totalBreakMinutes) : "—",
        formatHoursDecimal(netWorkedMinutes) + " h",
      ];
      if (hasUnpaid) row.splice(6, 0, unpaidBreakMinutes > 0 ? `-${formatMinutes(unpaidBreakMinutes)}` : "—");
      rows.push(row);
    });
  });

  if (rows.length === 0) {
    const emptyRow = ["No timesheet data for this period.", "", "", "", "", "", ""];
    if (hasUnpaid) emptyRow.push("");
    rows.push(emptyRow);
  }

  const head = hasUnpaid
    ? [["Date", "Employee", "Role", "Clock In", "Clock Out", "Break", "Unpaid", "Hours"]]
    : [["Date", "Employee", "Role", "Clock In", "Clock Out", "Break", "Hours"]];

  const foot = rows.length > 1
    ? hasUnpaid
      ? [["", "", "", "", "", "", "Total", formatHoursDecimal(grandTotal) + " h"]]
      : [["", "", "", "", "", "Total", formatHoursDecimal(grandTotal) + " h"]]
    : undefined;

  const colStyles: Record<number, object> = hasUnpaid
    ? { 0: { cellWidth: 38 }, 1: { cellWidth: 32 }, 2: { cellWidth: 26 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20 }, 5: { cellWidth: 18 }, 6: { cellWidth: 18, textColor: [200, 60, 60] }, 7: { cellWidth: 20, halign: "right" } }
    : { 0: { cellWidth: 42 }, 1: { cellWidth: 36 }, 2: { cellWidth: 30 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 }, 5: { cellWidth: 22 }, 6: { cellWidth: 22, halign: "right" } };

  autoTable(doc, {
    startY: paidBreakMinutes != null && paidBreakMinutes > 0 ? 34 : 30,
    head,
    body: rows,
    foot,
    headStyles: { fillColor: [139, 158, 139], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: colStyles,
  });

  const safeLabel = rangeLabel.replace(/[^a-zA-Z0-9-]/g, "_");
  doc.save(`timesheets_${safeLabel}.pdf`);
}

export default function Timesheets() {
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
  const [clockPicker, setClockPicker] = useState<{ open: boolean; value: string; onConfirm: (v: string) => void }>({
    open: false, value: "00:00", onConfirm: () => {}
  });

  const openClock = (initialTime: string, onConfirm: (v: string) => void) => {
    setClockPicker({ open: true, value: initialTime || format(new Date(), "HH:mm"), onConfirm });
  };
  const [viewingEmployeeId, setViewingEmployeeId] = useState<number | null>(null);
  const [viewingDate, setViewingDate] = useState<Date | null>(null);
  const [addingTimesheet, setAddingTimesheet] = useState(false);
  const [newTimesheetEmployeeId, setNewTimesheetEmployeeId] = useState<string>("");
  const [newTimesheetClockIn, setNewTimesheetClockIn] = useState<string>("");
  const [newTimesheetClockOut, setNewTimesheetClockOut] = useState<string>("");
  const [newTimesheetBreakStart, setNewTimesheetBreakStart] = useState<string>("");
  const [newTimesheetBreakEnd, setNewTimesheetBreakEnd] = useState<string>("");
  const [addingClockOut, setAddingClockOut] = useState<EmployeeWorkday | null>(null);
  const [clockOutTime, setClockOutTime] = useState<string>("");
  const [editingBreak, setEditingBreak] = useState<{ start: TimeEntry | null, end: TimeEntry | null } | null>(null);
  const [editBreakStart, setEditBreakStart] = useState<string>("");
  const [editBreakEnd, setEditBreakEnd] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportSelectedEmployeeIds, setExportSelectedEmployeeIds] = useState<number[]>([]);
  const [exportStartDate, setExportStartDate] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [exportEndDate, setExportEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const { toast } = useToast();

  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekDays = useMemo(() => eachDayOfInterval({ start: selectedWeek, end: weekEnd }), [selectedWeek]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  const { data: customRoles = [] } = useQuery<CustomRole[]>({ queryKey: ["/api/roles"] });
  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({ queryKey: ["/api/kiosk/entries"] });
  const { data: breakPolicy } = useQuery<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }>({ queryKey: ["/api/settings/break-policy"] });
  const paidBreakMinutes = breakPolicy?.paidBreakMinutes ?? null;

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
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addEntryMutation = useMutation({
    mutationFn: async (data: { employeeId: number; type: string; date: string; timestamp: string }) => {
      const res = await apiRequest("POST", "/api/kiosk/entries", data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/kiosk/entries"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSaveBreakEdit = () => {
    if (!editingBreak) return;
    if (editingBreak.start && /^\d{2}:\d{2}$/.test(editBreakStart)) {
      const dateStr = editingBreak.start.date;
      updateEntryMutation.mutate({ id: editingBreak.start.id, timestamp: new Date(`${dateStr}T${editBreakStart}:00`).toISOString() });
    }
    if (editingBreak.end && /^\d{2}:\d{2}$/.test(editBreakEnd)) {
      const dateStr = editingBreak.end.date;
      updateEntryMutation.mutate({ id: editingBreak.end.id, timestamp: new Date(`${dateStr}T${editBreakEnd}:00`).toISOString() });
    }
    setEditingBreak(null);
  };

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

  const viewingWorkday = useMemo(() => {
    if (viewingEmployeeId === null) return null;
    const dateToUse = viewingDate || selectedDay;
    const dayWorkdays = buildWorkdaysForDate(entries, employees, dateToUse, selectedRole, employeeSearch, paidBreakMinutes);
    return dayWorkdays.find(w => w.employee.id === viewingEmployeeId) || null;
  }, [viewingEmployeeId, viewingDate, entries, employees, selectedDay, selectedRole, employeeSearch, paidBreakMinutes]);

  const activeDay = viewingDate || selectedDay;

  const totalHours = useMemo(() => {
    if (viewMode === "week") return workdays.reduce((s, w) => s + w.netWorkedMinutes, 0);
    return monthWorkdays.reduce((s, d) => s + d.workdays.reduce((ss, w) => ss + w.netWorkedMinutes, 0), 0);
  }, [viewMode, workdays, monthWorkdays]);

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
    if (!editingEntry || !editTime || !/^\d{2}:\d{2}$/.test(editTime)) return;
    const entryDate = editingEntry.date;
    const newTimestamp = new Date(`${entryDate}T${editTime}:00`);
    
    if (editingEntry.id) {
      updateEntryMutation.mutate({ id: editingEntry.id, timestamp: newTimestamp.toISOString() });
    } else {
      // Handling "Add End" case where id is missing
      addEntryMutation.mutate({
        employeeId: editingEntry.employeeId,
        type: editingEntry.type,
        date: entryDate,
        timestamp: newTimestamp.toISOString()
      }, {
        onSuccess: () => {
          setEditingEntry(null);
          setViewingEmployeeId(null); // Refresh the view
        }
      });
    }
  };

  const handleSaveShiftEdit = () => {
    if (!editingShift || !/^\d{2}:\d{2}$/.test(editShiftClockIn)) return;
    const dateStr = format(activeDay, "yyyy-MM-dd");
    const clockInEntry = editingShift.entries.find(e => e.type === "clock-in");
    const clockOutEntry = editingShift.entries.find(e => e.type === "clock-out");
    if (clockInEntry) updateEntryMutation.mutate({ id: clockInEntry.id, timestamp: new Date(`${dateStr}T${editShiftClockIn}:00`).toISOString() });
    if (clockOutEntry && /^\d{2}:\d{2}$/.test(editShiftClockOut)) updateEntryMutation.mutate({ id: clockOutEntry.id, timestamp: new Date(`${dateStr}T${editShiftClockOut}:00`).toISOString() });
    setEditingShift(null);
  };

  const [addingNewBreak, setAddingNewBreak] = useState<EmployeeWorkday | null>(null);
  const [newBreakStartTime, setNewBreakStartTime] = useState<string>("");
  const [newBreakEndTime, setNewBreakEndTime] = useState<string>("");

  const handleAddNewBreak = () => {
    if (!addingNewBreak || !newBreakStartTime || !newBreakEndTime) return;
    if (!/^\d{2}:\d{2}$/.test(newBreakStartTime) || !/^\d{2}:\d{2}$/.test(newBreakEndTime)) return;
    const dateStr = format(activeDay, "yyyy-MM-dd");
    addEntryMutation.mutate(
      { employeeId: addingNewBreak.employee.id, type: "break-start", date: dateStr, timestamp: new Date(`${dateStr}T${newBreakStartTime}:00`).toISOString() },
      {
        onSuccess: () => {
          addEntryMutation.mutate(
            { employeeId: addingNewBreak!.employee.id, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${newBreakEndTime}:00`).toISOString() },
            {
              onSuccess: () => {
                setAddingNewBreak(null); setNewBreakStartTime(""); setNewBreakEndTime(""); setViewingEmployeeId(null);
                toast({ title: "Success", description: "Break added" });
              }
            }
          );
        }
      }
    );
  };

  const handleAddClockOut = () => {
    if (!addingClockOut || !clockOutTime || !/^\d{2}:\d{2}$/.test(clockOutTime)) return;
    const dateStr = format(activeDay, "yyyy-MM-dd");
    addEntryMutation.mutate(
      { employeeId: addingClockOut.employee.id, type: "clock-out", date: dateStr, timestamp: new Date(`${dateStr}T${clockOutTime}:00`).toISOString() },
      {
        onSuccess: () => {
          setAddingClockOut(null); setClockOutTime(""); setViewingEmployeeId(null);
          toast({ title: "Success", description: "Clock out added" });
        }
      }
    );
  };

  const handleAddTimesheet = async () => {
    if (!newTimesheetEmployeeId || !newTimesheetClockIn || !/^\d{2}:\d{2}$/.test(newTimesheetClockIn)) return;
    const dateStr = format(selectedDay, "yyyy-MM-dd");
    const empId = Number(newTimesheetEmployeeId);
    await addEntryMutation.mutateAsync({ employeeId: empId, type: "clock-in", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetClockIn}:00`).toISOString() });
    if (newTimesheetBreakStart && newTimesheetBreakEnd && /^\d{2}:\d{2}$/.test(newTimesheetBreakStart) && /^\d{2}:\d{2}$/.test(newTimesheetBreakEnd)) {
      await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-start", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetBreakStart}:00`).toISOString() });
      await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetBreakEnd}:00`).toISOString() });
    }
    if (newTimesheetClockOut && /^\d{2}:\d{2}$/.test(newTimesheetClockOut)) {
      await addEntryMutation.mutateAsync({ employeeId: empId, type: "clock-out", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetClockOut}:00`).toISOString() });
    }
    toast({ title: "Success", description: "Timesheet added" });
    setAddingTimesheet(false); setNewTimesheetEmployeeId(""); setNewTimesheetClockIn(""); setNewTimesheetClockOut(""); setNewTimesheetBreakStart(""); setNewTimesheetBreakEnd("");
  };

  const handleExportPDF = async () => {
    if (exportSelectedEmployeeIds.length === 0) {
      toast({ title: "Error", description: "Please select at least one employee", variant: "destructive" });
      return;
    }
    setIsExporting(true);
    try {
      const start = new Date(exportStartDate);
      const end = new Date(exportEndDate);
      const rangeLabel = `Period: ${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
      await exportPDF(start, end, rangeLabel, entries, employees, exportSelectedEmployeeIds, paidBreakMinutes);
      setExportDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const toggleExportEmployee = (id: number) => {
    setExportSelectedEmployeeIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const WorkdayCard = ({ wd, date }: { wd: EmployeeWorkday; date: Date }) => {
    const { employee: emp, clockIn, clockOut, netWorkedMinutes, totalBreakMinutes, unpaidBreakMinutes, status } = wd;
    const sc = statusConfig[status];
    return (
      <button
        key={emp.id}
        onClick={() => { setViewingEmployeeId(wd.employee.id); setViewingDate(date); }}
        className="w-full flex items-start gap-3 p-4 rounded-md border bg-card hover-elevate text-left cursor-pointer"
        data-testid={`timesheet-card-${emp.id}`}
      >
        <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold truncate">{emp.name}</span>
            <span className="text-xs font-semibold whitespace-nowrap" style={{ color: sc.color }}>{sc.label}</span>
          </div>
          <div className="text-base font-bold mt-0.5" data-testid={`text-work-time-${emp.id}`}>
            {clockIn ? format(clockIn, "HH:mm") : "--:--"} - {clockOut ? format(clockOut, "HH:mm") : ""}
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground">{emp.role || "Loose Leaf (assign role)"}</span>
            <span className="text-sm font-semibold text-muted-foreground">{formatHoursDecimal(netWorkedMinutes)} h</span>
          </div>
          {totalBreakMinutes > 0 && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Break: {formatMinutes(totalBreakMinutes)}
              {unpaidBreakMinutes > 0 && (
                <span className="text-red-500 ml-1">(-{formatMinutes(unpaidBreakMinutes)} unpaid)</span>
              )}
            </div>
          )}
        </div>
      </button>
    );
  };

  if (empsLoading || entriesLoading) {
    return (
      <div className="h-full overflow-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-16 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-md" />)}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex flex-col">
      <div className="p-4 pb-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold" data-testid="text-timesheets-title">Timesheets</h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center border rounded-md overflow-hidden">
              <Button
                variant={viewMode === "week" ? "default" : "ghost"}
                size="sm"
                className="rounded-none h-8 px-3 text-xs gap-1.5"
                onClick={() => setViewMode("week")}
                data-testid="button-view-week"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                Week
              </Button>
              <Button
                variant={viewMode === "month" ? "default" : "ghost"}
                size="sm"
                className="rounded-none h-8 px-3 text-xs gap-1.5"
                onClick={() => setViewMode("month")}
                data-testid="button-view-month"
              >
                <Calendar className="w-3.5 h-3.5" />
                Month
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs gap-1.5"
              onClick={() => {
                setExportSelectedEmployeeIds(employees.map(e => e.id));
                setExportDialogOpen(true);
              }}
              data-testid="button-export-pdf"
            >
              <FileDown className="w-3.5 h-3.5" />
              Export PDF
            </Button>
          </div>
        </div>

        {viewMode === "week" ? (
          <>
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
          </>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigateMonth(-1)} data-testid="button-month-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold" data-testid="text-month-range">
              {format(selectedMonth, "MMMM yyyy")}
            </span>
            <Button variant="ghost" size="icon" onClick={() => navigateMonth(1)} data-testid="button-month-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 pb-2">
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="w-[150px]" data-testid="select-role-filter">
              <SelectValue placeholder="All Positions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Positions</SelectItem>
              {customRoles.map(role => (
                <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={employeeSearch === "" ? "all" : employeeSearch}
            onValueChange={(val) => setEmployeeSearch(val === "all" ? "" : val)}
          >
            <SelectTrigger className="w-[180px]" data-testid="select-employee-filter">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees
                .filter(e => e.status === "active")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(emp => (
                  <SelectItem key={emp.id} value={emp.name}>{emp.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
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
        {viewMode === "week" ? (
          workdays.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No entries for this day.</div>
          ) : (
            workdays.map(wd => <WorkdayCard key={wd.employee.id} wd={wd} date={selectedDay} />)
          )
        ) : (
          monthWorkdays.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No entries for this month.</div>
          ) : (
            monthWorkdays.map(({ date, workdays: dayWds }) => (
              <div key={date.toISOString()} className="space-y-2">
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {format(date, "EEEE, MMM d")}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">
                    {formatHoursDecimal(dayWds.reduce((s, w) => s + w.netWorkedMinutes, 0))} h total
                  </span>
                </div>
                {dayWds.map(wd => <WorkdayCard key={wd.employee.id} wd={wd} date={date} />)}
              </div>
            ))
          )
        )}
      </div>

      {(viewMode === "week" ? workdays.length > 0 : monthWorkdays.length > 0) && (
        <div className="border-t px-4 py-3 flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-lg font-bold" data-testid="text-total-hours">{formatHoursDecimal(totalHours)} h</span>
        </div>
      )}

      {/* Export PDF Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export Timesheet PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Time Period</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">From</span>
                  <DateInput
                    value={exportStartDate}
                    onChange={setExportStartDate}
                    data-testid="input-export-start-date"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">To</span>
                  <DateInput
                    value={exportEndDate}
                    onChange={setExportEndDate}
                    data-testid="input-export-end-date"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Employees</Label>
                <Button 
                  variant="link" 
                  size="sm" 
                  className="h-auto p-0 text-[11px]" 
                  onClick={() => setExportSelectedEmployeeIds(
                    exportSelectedEmployeeIds.length === employees.length ? [] : employees.map(e => e.id)
                  )}
                >
                  {exportSelectedEmployeeIds.length === employees.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
              <div className="max-h-48 overflow-auto border rounded-md p-2 space-y-1">
                {employees
                  .filter(e => e.status === "active")
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(emp => (
                    <div 
                      key={emp.id} 
                      className="flex items-center gap-2 p-1.5 rounded-sm hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => toggleExportEmployee(emp.id)}
                    >
                      <Checkbox 
                        checked={exportSelectedEmployeeIds.includes(emp.id)} 
                        onCheckedChange={() => toggleExportEmployee(emp.id)}
                        id={`export-emp-${emp.id}`}
                      />
                      <Label 
                        htmlFor={`export-emp-${emp.id}`} 
                        className="text-xs font-normal cursor-pointer flex-1"
                      >
                        {emp.name}
                      </Label>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleExportPDF} 
              disabled={isExporting || exportSelectedEmployeeIds.length === 0}
              className="gap-2"
            >
              <FileDown className="w-4 h-4" />
              {isExporting ? "Generating..." : "Download PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!viewingWorkday} onOpenChange={() => { setViewingEmployeeId(null); setViewingDate(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Timesheet Details</DialogTitle></DialogHeader>
          {viewingWorkday && (() => {
            const { employee: emp, entries: dayEntries, clockIn, clockOut, netWorkedMinutes, totalBreakMinutes, unpaidBreakMinutes, status } = viewingWorkday;
            const sc = statusConfig[status];
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
                  <div>
                    <div className="font-semibold">{emp.name}</div>
                    <div className="text-xs text-muted-foreground">{emp.role || "Loose Leaf"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Date</div>
                    <div className="font-medium">{format(activeDay, "EEE, MMM d, yyyy")}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Status</div>
                    <span className="text-xs font-semibold" style={{ color: sc.color }}>{sc.label}</span>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Worked</div>
                    <div className="font-medium">{formatMinutes(netWorkedMinutes)} ({formatHoursDecimal(netWorkedMinutes)} h)</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Break</div>
                    <div className="font-medium">{totalBreakMinutes > 0 ? formatMinutes(totalBreakMinutes) : "No break"}</div>
                    {unpaidBreakMinutes > 0 && (
                      <div className="text-[11px] text-red-500">-{formatMinutes(unpaidBreakMinutes)} deducted</div>
                    )}
                  </div>
                </div>
                {(() => {
                  const clockInEntry = dayEntries.find(e => e.type === "clock-in");
                  const clockOutEntry = dayEntries.find(e => e.type === "clock-out");
                  const dateStr = format(activeDay, "yyyy-MM-dd");
                  return (
                    <div className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shift Time</span>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => {
                              setEditingShift(viewingWorkday);
                              setEditShiftClockIn(clockIn ? format(clockIn, "HH:mm") : "");
                              setEditShiftClockOut(clockOut ? format(clockOut, "HH:mm") : "");
                            }}
                            data-testid="button-edit-shift-time"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          {!clockOut && (
                            <Button variant="outline" size="sm" className="h-6 text-xs px-2"
                              onClick={() => openClock(format(new Date(), "HH:mm"), (v) => {
                                addEntryMutation.mutate({ employeeId: emp.id, type: "clock-out", date: dateStr, timestamp: new Date(`${dateStr}T${v}:00`).toISOString() });
                              })}
                              data-testid="button-add-clock-out"
                            >
                              <Plus className="w-3 h-3 mr-1" /> Add Clock Out
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground mb-0.5">Clock In</div>
                          <div className="font-medium font-mono">{clockIn ? format(clockIn, "HH:mm") : "—"}</div>
                        </div>
                        <div className="text-muted-foreground mt-3">→</div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-0.5">Clock Out</div>
                          <div className="font-medium font-mono">{clockOut ? format(clockOut, "HH:mm") : "—"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {(() => {
                  const breakStart = dayEntries.find(e => e.type === "break-start");
                  const breakEnd = dayEntries.find(e => e.type === "break-end");
                  if (!breakStart && !breakEnd) return null;
                  const dateStr = format(activeDay, "yyyy-MM-dd");
                  return (
                    <div className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Break Time</span>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => {
                              setEditingBreak({ start: breakStart || null, end: breakEnd || null });
                              setEditBreakStart(breakStart ? format(new Date(breakStart.timestamp), "HH:mm") : "");
                              setEditBreakEnd(breakEnd ? format(new Date(breakEnd.timestamp), "HH:mm") : "");
                            }}
                            data-testid="button-edit-break-time"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          {!breakEnd && (
                            <Button variant="outline" size="sm" className="h-6 text-xs px-2"
                              onClick={() => openClock(format(new Date(), "HH:mm"), (v) => {
                                addEntryMutation.mutate({ employeeId: emp.id, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${v}:00`).toISOString() });
                              })}
                              data-testid="button-add-break-end"
                            >
                              <Plus className="w-3 h-3 mr-1" /> Add End Break
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground mb-0.5">Start</div>
                          <div className="font-medium font-mono">{breakStart ? format(new Date(breakStart.timestamp), "HH:mm") : "—"}</div>
                        </div>
                        <div className="text-muted-foreground mt-3">→</div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-0.5">End</div>
                          <div className="font-medium font-mono">{breakEnd ? format(new Date(breakEnd.timestamp), "HH:mm") : "—"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <Button variant="outline" size="sm" className="w-full"
                  onClick={() => {
                    const dateStr = format(activeDay, "yyyy-MM-dd");
                    openClock(format(new Date(), "HH:mm"), (startVal) => {
                      addEntryMutation.mutate(
                        { employeeId: emp.id, type: "break-start", date: dateStr, timestamp: new Date(`${dateStr}T${startVal}:00`).toISOString() },
                        { onSuccess: () => {
                          openClock(format(new Date(), "HH:mm"), (endVal) => {
                            addEntryMutation.mutate({ employeeId: emp.id, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${endVal}:00`).toISOString() });
                          });
                        }}
                      );
                    });
                  }}
                  data-testid="button-add-break"
                >
                  <Coffee className="w-4 h-4 mr-2" /> Add Break
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit Shift dialog — pencil edits both Clock In and Clock Out */}
      <Dialog open={!!editingShift} onOpenChange={() => setEditingShift(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Shift Time</DialogTitle></DialogHeader>
          {editingShift && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground">{editingShift.employee.name} — {format(activeDay, "EEE, MMM d, yyyy")}</div>
              <div className="space-y-2">
                <Label>Clock In / Clock Out</Label>
                <TimeRangeInput startValue={editShiftClockIn} endValue={editShiftClockOut} onStartChange={setEditShiftClockIn} onEndChange={setEditShiftClockOut} startTestId="input-edit-shift-clock-in" endTestId="input-edit-shift-clock-out" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingShift(null)}>Cancel</Button>
            <Button onClick={handleSaveShiftEdit} disabled={updateEntryMutation.isPending || !/^\d{2}:\d{2}$/.test(editShiftClockIn)} data-testid="button-save-shift-edit">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Break dialog — pencil edits both Break Start and Break End */}
      <Dialog open={!!editingBreak} onOpenChange={() => setEditingBreak(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Break Time</DialogTitle></DialogHeader>
          {editingBreak && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Break Start / Break End</Label>
                <TimeRangeInput startValue={editBreakStart} endValue={editBreakEnd} onStartChange={setEditBreakStart} onEndChange={setEditBreakEnd} startTestId="input-edit-break-start" endTestId="input-edit-break-end" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBreak(null)}>Cancel</Button>
            <Button onClick={handleSaveBreakEdit} disabled={updateEntryMutation.isPending} data-testid="button-save-break-edit">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Direct Clock Picker — only for single-action adds (Add Clock Out, Add End Break, Add Break) */}
      <ClockPickerDialog
        open={clockPicker.open}
        onOpenChange={(open) => setClockPicker(p => ({ ...p, open }))}
        value={clockPicker.value}
        onChange={(v) => { clockPicker.onConfirm(v); setClockPicker(p => ({ ...p, open: false })); }}
      />

      {/* Add Timesheet */}
      <Dialog open={addingTimesheet} onOpenChange={setAddingTimesheet}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Missing Timesheet</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">{format(selectedDay, "EEEE, MMM d, yyyy")}</div>
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={newTimesheetEmployeeId} onValueChange={setNewTimesheetEmployeeId}>
                <SelectTrigger data-testid="select-timesheet-employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.filter(e => e.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(emp => (
                    <SelectItem key={emp.id} value={String(emp.id)}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Shift Time</Label>
              <TimeRangeInput startValue={newTimesheetClockIn} endValue={newTimesheetClockOut} onStartChange={setNewTimesheetClockIn} onEndChange={setNewTimesheetClockOut} startTestId="input-timesheet-clock-in" endTestId="input-timesheet-clock-out" />
              <p className="text-xs text-muted-foreground">Clock out is optional</p>
            </div>
            <div className="space-y-2">
              <Label>Break <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <TimeRangeInput startValue={newTimesheetBreakStart} endValue={newTimesheetBreakEnd} onStartChange={setNewTimesheetBreakStart} onEndChange={setNewTimesheetBreakEnd} startTestId="input-timesheet-break-start" endTestId="input-timesheet-break-end" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingTimesheet(false)}>Cancel</Button>
            <Button onClick={handleAddTimesheet} disabled={addEntryMutation.isPending || !newTimesheetEmployeeId || !/^\d{2}:\d{2}$/.test(newTimesheetClockIn)} data-testid="button-save-timesheet">
              Add Timesheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
