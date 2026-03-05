import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isSameDay,
  differenceInMinutes, startOfMonth, endOfMonth, addMonths, subMonths, addDays, parseISO,
} from "date-fns";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Edit2, Plus, Coffee, Search, FileDown, FileUp, Calendar, CalendarDays, Check, AlertCircle, StickyNote, Trash2, Clock as ClockIcon, AlertTriangle } from "lucide-react";
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
import CsvImporter from "@/components/csv-importer";
import type { Employee, TimeEntry, CustomRole, ApprovalRequest } from "@shared/schema";

interface EmployeeWorkday {
  employee: Employee;
  entries: TimeEntry[];
  clockIn: Date | null;
  clockOut: Date | null;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  forcedUnpaidBreakMinutes: number;
  unpaidBreakMinutes: number;
  netWorkedMinutes: number;
  hasUnfinishedBreak: boolean;
  status: "working" | "on-break" | "completed" | "incomplete";
}

function processEntriesForEmployee(emp: Employee, dayEntries: TimeEntry[], paidBreakMinutes?: number | null): EmployeeWorkday[] {
  const sorted = [...dayEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const workdays: EmployeeWorkday[] = [];
  let currentWorkday: Partial<EmployeeWorkday> & { lastClockIn: Date | null; lastBreakStart: Date | null; onBreak: boolean; hasUnfinishedBreak: boolean; currentBreakIsUnpaid: boolean } | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const ts = new Date(entry.timestamp);
    
    if (entry.type === "clock-in") {
      if (currentWorkday && !currentWorkday.clockOut) {
        // New clock-in while previous session is still open — finalize it as incomplete
        currentWorkday.status = "incomplete";
        workdays.push(finalizeWorkday(emp, currentWorkday as any, paidBreakMinutes));
        currentWorkday = null;
      }
      
      currentWorkday = {
        employee: emp,
        entries: [],
        clockIn: ts,
        clockOut: null,
        totalWorkedMinutes: 0,
        totalBreakMinutes: 0,
        forcedUnpaidBreakMinutes: 0,
        hasUnfinishedBreak: false,
        status: "working",
        lastClockIn: ts,
        lastBreakStart: null,
        onBreak: false,
        currentBreakIsUnpaid: false,
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
        } else if (currentWorkday.lastBreakStart) {
          // Break is open at clock-out time. Check if a break-end exists later in the
          // sorted entries (before the next clock-in). This happens when "Reopen Shift"
          // inserts a break-end with a timestamp after the user's re-added clock-out.
          let hasOutOfOrderBreakEnd = false;
          for (let j = i + 1; j < sorted.length; j++) {
            if (sorted[j].type === "clock-in") break;
            if (sorted[j].type === "break-end") { hasOutOfOrderBreakEnd = true; break; }
          }
          if (hasOutOfOrderBreakEnd) {
            // Treat the break as ending at clock-out; count break time normally.
            currentWorkday.totalBreakMinutes! += differenceInMinutes(ts, currentWorkday.lastBreakStart);
            currentWorkday.lastBreakStart = null;
            currentWorkday.onBreak = false;
          } else {
            // Genuine unfinished break — don't count the gap as worked or break time.
            currentWorkday.hasUnfinishedBreak = true;
            currentWorkday.lastBreakStart = null;
            currentWorkday.onBreak = false;
          }
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
        currentWorkday.currentBreakIsUnpaid = entry.isUnpaid ?? false;
        if (currentWorkday.lastClockIn) {
          currentWorkday.totalWorkedMinutes! += differenceInMinutes(ts, currentWorkday.lastClockIn);
          currentWorkday.lastClockIn = null;
        }
        break;
      case "break-end":
        currentWorkday.onBreak = false;
        currentWorkday.status = "working";
        if (currentWorkday.lastBreakStart) {
          const breakDuration = differenceInMinutes(ts, currentWorkday.lastBreakStart);
          currentWorkday.totalBreakMinutes! += breakDuration;
          if (currentWorkday.currentBreakIsUnpaid) {
            currentWorkday.forcedUnpaidBreakMinutes! += breakDuration;
          }
          currentWorkday.lastBreakStart = null;
          currentWorkday.currentBreakIsUnpaid = false;
        }
        currentWorkday.lastClockIn = ts;
        break;
    }
  }

  // Handle open session
  if (currentWorkday) {
    const lastClockInRef = currentWorkday.lastClockIn || currentWorkday.clockIn;
    const hoursElapsed = lastClockInRef ? differenceInMinutes(new Date(), lastClockInRef) / 60 : 25;
    
    if (hoursElapsed >= 24) {
      // Session was never closed — mark as incomplete, don't calculate worked time
      currentWorkday.status = "incomplete";
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
    forcedUnpaidBreakMinutes: 0,
    unpaidBreakMinutes: 0,
    netWorkedMinutes: 0,
    hasUnfinishedBreak: false,
    status: "completed"
  }];
}

function finalizeWorkday(emp: Employee, wd: any, paidBreakMinutes?: number | null): EmployeeWorkday {
  const forcedUnpaid = wd.forcedUnpaidBreakMinutes ?? 0;
  const regularBreakMinutes = (wd.totalBreakMinutes ?? 0) - forcedUnpaid;
  const policyUnpaid = (paidBreakMinutes != null && paidBreakMinutes >= 0)
    ? Math.max(0, regularBreakMinutes - paidBreakMinutes)
    : 0;
  const unpaidBreakMinutes = forcedUnpaid + policyUnpaid;
  const netWorkedMinutes = Math.max(0, (wd.totalWorkedMinutes ?? 0) - unpaidBreakMinutes);
  
  return {
    employee: emp,
    entries: wd.entries,
    clockIn: wd.clockIn,
    clockOut: wd.clockOut,
    totalWorkedMinutes: wd.totalWorkedMinutes,
    forcedUnpaidBreakMinutes: forcedUnpaid,
    totalBreakMinutes: wd.totalBreakMinutes,
    unpaidBreakMinutes,
    netWorkedMinutes,
    hasUnfinishedBreak: wd.hasUnfinishedBreak ?? false,
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
    const byEmployee = new Map<number, typeof workdays>();
    workdays.forEach(wd => {
      if (wd.status !== "completed") return;
      const list = byEmployee.get(wd.employee.id) || [];
      list.push(wd);
      byEmployee.set(wd.employee.id, list);
    });

    byEmployee.forEach((sessions) => {
      const totalNet = sessions.reduce((s, w) => s + w.netWorkedMinutes, 0);
      const totalBreak = sessions.reduce((s, w) => s + w.totalBreakMinutes, 0);
      const totalUnpaid = sessions.reduce((s, w) => s + w.unpaidBreakMinutes, 0);
      grandTotal += totalNet;

      sessions.forEach((wd, idx) => {
        const isFirst = idx === 0;
        const row: any[] = [];
        
        if (isFirst) {
          grandTotal += totalNet;
          row.push({ 
            content: format(date, "EEE, MMM d, yyyy"), 
            rowSpan: sessions.length,
            styles: { lineWidth: { top: 0.6, right: 0.1, bottom: 0.1, left: 0.1 }, fontStyle: 'bold', lineColor: [160, 180, 160] }
          });
          row.push({ 
            content: wd.employee.name, 
            rowSpan: sessions.length,
            styles: { lineWidth: { top: 0.6, right: 0.1, bottom: 0.1, left: 0.1 }, fontStyle: 'bold', lineColor: [160, 180, 160] }
          });
          row.push({ 
            content: wd.employee.role || "No Role", 
            rowSpan: sessions.length,
            styles: { lineWidth: { top: 0.6, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: [160, 180, 160] }
          });
        }

        const clockInStr = wd.clockIn ? format(wd.clockIn, "HH:mm") : "—";
        const clockOutStr = wd.clockOut ? format(wd.clockOut, "HH:mm") : "—";
        row.push({ 
          content: clockInStr, 
          styles: { lineWidth: { top: isFirst ? 0.6 : 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: isFirst ? [160, 180, 160] : [150, 150, 150] }
        });
        row.push({ 
          content: clockOutStr, 
          styles: { lineWidth: { top: isFirst ? 0.6 : 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: isFirst ? [160, 180, 160] : [150, 150, 150] }
        });

        const breakStr = wd.totalBreakMinutes > 0 ? formatMinutes(wd.totalBreakMinutes) : "—";
        row.push({ 
          content: breakStr, 
          styles: { lineWidth: { top: isFirst ? 0.6 : 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: isFirst ? [160, 180, 160] : [150, 150, 150] }
        });

        if (hasUnpaid) {
          const unpaidStr = wd.unpaidBreakMinutes > 0 ? `-${formatMinutes(wd.unpaidBreakMinutes)}` : "—";
          row.push({ 
            content: unpaidStr, 
            styles: { lineWidth: { top: isFirst ? 0.6 : 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: isFirst ? [160, 180, 160] : [150, 150, 150] }
          });
        }

        if (isFirst) {
          row.push({ 
            content: formatHoursDecimal(totalNet) + " h", 
            rowSpan: sessions.length,
            styles: { lineWidth: { top: 0.6, right: 0.1, bottom: 0.1, left: 0.1 }, halign: "right", fontStyle: 'bold', lineColor: [160, 180, 160] }
          });
        }
        
        rows.push(row);
      });
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
    ? { 0: { cellWidth: 40 }, 1: { cellWidth: 35 }, 2: { cellWidth: 25 }, 3: { cellWidth: 14 }, 4: { cellWidth: 14 }, 5: { cellWidth: 14 }, 6: { cellWidth: 14, textColor: [200, 60, 60] }, 7: { cellWidth: 18, halign: "right" } }
    : { 0: { cellWidth: 45 }, 1: { cellWidth: 40 }, 2: { cellWidth: 30 }, 3: { cellWidth: 15 }, 4: { cellWidth: 15 }, 5: { cellWidth: 15 }, 6: { cellWidth: 20, halign: "right" } };

  autoTable(doc, {
    startY: paidBreakMinutes != null && paidBreakMinutes > 0 ? 34 : 30,
    head,
    body: rows,
    foot,
    headStyles: { fillColor: [139, 158, 139], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontStyle: "bold", lineWidth: { top: 0.5, bottom: 0.5, left: 0.1, right: 0.1 } },
    styles: { 
      fontSize: 9, 
      cellPadding: 2, 
      lineWidth: 0.1, 
      lineColor: [150, 150, 150],
      valign: "middle"
    },
    columnStyles: colStyles,
  });

  const safeLabel = rangeLabel.replace(/[^a-zA-Z0-9-]/g, "_");
  doc.save(`timesheets_${safeLabel}.pdf`);
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
  const [newTimesheetRole, setNewTimesheetRole] = useState<string>("");

  const resetAddTimesheetForm = () => {
    setNewTimesheetEmployeeId("");
    setNewTimesheetClockIn("");
    setNewTimesheetClockOut("");
    setNewTimesheetBreakStart("");
    setNewTimesheetBreakEnd("");
    setNewTimesheetRole("");
  };

  const [addingClockOut, setAddingClockOut] = useState<EmployeeWorkday | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clockOutTime, setClockOutTime] = useState<string>("");
  const [editingBreak, setEditingBreak] = useState<{ start: TimeEntry | null, end: TimeEntry | null } | null>(null);
  const [editBreakStart, setEditBreakStart] = useState<string>("");
  const [editBreakEnd, setEditBreakEnd] = useState<string>("");
  const [shiftWarning, setShiftWarning] = useState<{
    title: string;
    description: string;
    actions: { label: string; variant?: "default" | "destructive" | "outline"; onClick: () => void }[];
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportSelectedEmployeeIds, setExportSelectedEmployeeIds] = useState<number[]>([]);
  const [exportStartDate, setExportStartDate] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [exportEndDate, setExportEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [csvImporterOpen, setCsvImporterOpen] = useState(false);
  const [reopenGapDialog, setReopenGapDialog] = useState<{ clockOutEntry: TimeEntry; gapMinutes: number; employeeId: number; clockOutDate: string } | null>(null);
  const { toast } = useToast();

  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekDays = useMemo(() => eachDayOfInterval({ start: selectedWeek, end: weekEnd }), [selectedWeek]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  const { data: customRoles = [] } = useQuery<CustomRole[]>({ queryKey: ["/api/roles"] });
  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({ queryKey: ["/api/steepin/entries"] });
  const { data: breakPolicy } = useQuery<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }>({ queryKey: ["/api/settings/break-policy"] });
  const paidBreakMinutes = breakPolicy?.paidBreakMinutes ?? null;
  const { data: approvalRequests = [] } = useQuery<ApprovalRequest[]>({ queryKey: ["/api/approval-requests"] });

  const approvalMutation = useMutation({
    mutationFn: async ({ id, status, managerResponse }: { id: number; status: string; managerResponse?: string }) => {
      const res = await apiRequest("PATCH", `/api/approval-requests/${id}`, { status, managerResponse });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] });
      toast({ title: "Success", description: "Approval request updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateEntryMutation = useMutation({
    mutationFn: async (data: { id: number; timestamp: string; role?: string }) => {
      const body: any = { timestamp: data.timestamp };
      if (data.role !== undefined) body.role = data.role;
      const res = await apiRequest("PATCH", `/api/steepin/entries/${data.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] });
      toast({ title: "Success", description: "Time updated successfully" });
      setEditingEntry(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addEntryMutation = useMutation({
    mutationFn: async (data: { employeeId: number; type: string; date: string; timestamp: string; role?: string }) => {
      const res = await apiRequest("POST", "/api/steepin/entries", data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/steepin/entries/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reopenShiftMutation = useMutation({
    mutationFn: async ({ clockOutEntryId, employeeId, clockOutDate, clockOutTimestamp, gapOption }: {
      clockOutEntryId: number; employeeId: number; clockOutDate: string; clockOutTimestamp: string; gapOption: "break" | "unpaid-break" | "worked";
    }) => {
      if (gapOption === "break" || gapOption === "unpaid-break") {
        const isUnpaid = gapOption === "unpaid-break";
        await apiRequest("POST", "/api/steepin/entries", { employeeId, type: "break-start", date: clockOutDate, timestamp: clockOutTimestamp, isUnpaid });
        const nowIso = new Date().toISOString();
        await apiRequest("POST", "/api/steepin/entries", { employeeId, type: "break-end", date: clockOutDate, timestamp: nowIso });
      }
      await apiRequest("DELETE", `/api/steepin/entries/${clockOutEntryId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] });
      setReopenGapDialog(null);
      toast({ title: "Shift reopened", description: "The clock-out has been removed and the shift is now in progress." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteTimesheetMutation = useMutation({
    mutationFn: async (data: { employeeId: number; date: string; entries: TimeEntry[] }) => {
      for (const entry of data.entries) {
        await apiRequest("DELETE", `/api/steepin/entries/${entry.id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] });
      toast({ title: "Success", description: "Timesheet deleted successfully" });
      setSelectedWorkday(null);
      setViewingDate(null);
      setConfirmDelete(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });


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

  const setViewingWorkdayManual = (wd: EmployeeWorkday, date: Date) => {
    setSelectedWorkday(wd);
    setViewingDate(date);
  };

  const viewingWorkday = useMemo(() => {
    if (!selectedWorkday) return null;
    const dateToUse = viewingDate || selectedDay;
    const dayWorkdays = buildWorkdaysForDate(entries, employees, dateToUse, selectedRole, employeeSearch, paidBreakMinutes);
    // Find matching session by clockIn time
    return dayWorkdays.find(w => 
      w.employee.id === selectedWorkday.employee.id && 
      w.clockIn?.getTime() === selectedWorkday.clockIn?.getTime()
    ) || null;
  }, [selectedWorkday, viewingDate, entries, employees, selectedDay, selectedRole, employeeSearch, paidBreakMinutes]);

  const activeDay = viewingDate || selectedDay;

  const totalHours = useMemo(() => {
    if (viewMode === "week") return workdays.reduce((s, w) => s + w.netWorkedMinutes, 0);
    return monthWorkdays.reduce((s, d) => s + d.workdays.reduce((ss, w) => ss + w.netWorkedMinutes, 0), 0);
  }, [viewMode, workdays, monthWorkdays]);

  const statusConfig: Record<string, { label: string; color: string }> = {
    working: { label: "Working", color: "#10B981" },
    "on-break": { label: "On Break", color: "#F59E0B" },
    completed: { label: "Completed", color: "#3B82F6" },
    incomplete: { label: "Incomplete", color: "#EF4444" },
  };

  const handleEditEntry = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditTime(format(new Date(entry.timestamp), "HH:mm"));
  };

  const handleSaveEdit = () => {
    if (!editingEntry || !editTime || !/^\d{2}:\d{2}$/.test(editTime)) return;
    const entryDate = editingEntry.date;
    const newTimestamp = new Date(`${entryDate}T${editTime}:00`);

    // Validation: Check for chronological order within the session
    if (viewingWorkday) {
      const otherEntries = viewingWorkday.entries.filter(e => e.id !== editingEntry.id);
      const isInvalid = otherEntries.some(e => {
        const otherTs = new Date(e.timestamp);
        if (editingEntry.type === "clock-in" && e.type !== "clock-in") return newTimestamp >= otherTs;
        if (editingEntry.type === "clock-out" && e.type !== "clock-out") return newTimestamp <= otherTs;
        if (editingEntry.type === "break-start") {
          if (e.type === "clock-in") return newTimestamp <= otherTs;
          if (e.type === "clock-out") return newTimestamp >= otherTs;
          if (e.type === "break-end" && e.timestamp) return newTimestamp >= otherTs;
        }
        if (editingEntry.type === "break-end") {
          if (e.type === "clock-in") return newTimestamp <= otherTs;
          if (e.type === "clock-out") return newTimestamp >= otherTs;
          if (e.type === "break-start" && e.timestamp) return newTimestamp <= otherTs;
        }
        return false;
      });

      if (isInvalid) {
        toast({
          title: "Invalid Time",
          description: "This time would conflict with other entries in this session (e.g., break before clock-in).",
          variant: "destructive"
        });
        return;
      }
    }
    
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
          setSelectedWorkday(null); // Refresh the view
        }
      });
    }
  };

  const handleSaveShiftEdit = () => {
    if (!editingShift || !/^\d{2}:\d{2}$/.test(editShiftClockIn)) return;
    const clockInEntry = editingShift.entries.find(e => e.type === "clock-in");
    const clockOutEntry = editingShift.entries.find(e => e.type === "clock-out");
    const dateStr = clockInEntry?.date || format(activeDay, "yyyy-MM-dd");

    const isOvernight = /^\d{2}:\d{2}$/.test(editShiftClockOut) && editShiftClockOut < editShiftClockIn;
    const clockOutDateStr = isOvernight ? format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd") : dateStr;
    const clockOutTimestamp = /^\d{2}:\d{2}$/.test(editShiftClockOut)
      ? new Date(`${clockOutDateStr}T${editShiftClockOut}:00`).toISOString()
      : null;

    const doSave = (finalClockOutTs: string | null, mergeSession: EmployeeWorkday | null) => {
      if (clockInEntry) {
        updateEntryMutation.mutate({ id: clockInEntry.id, timestamp: new Date(`${dateStr}T${editShiftClockIn}:00`).toISOString() });
      }
      if (finalClockOutTs) {
        if (clockOutEntry) {
          updateEntryMutation.mutate({ id: clockOutEntry.id, timestamp: finalClockOutTs });
        } else {
          addEntryMutation.mutate({ employeeId: editingShift!.employee.id, type: "clock-out", date: dateStr, timestamp: finalClockOutTs });
        }
      }
      if (mergeSession) {
        mergeSession.entries.forEach(e => deleteEntryMutation.mutate(e.id));
      }
      setEditingShift(null);
      setShiftWarning(null);
    };

    if (!clockOutTimestamp) {
      doSave(null, null);
      return;
    }

    const clockInTs = editingShift.clockIn!.getTime();
    const clockOutTs = new Date(clockOutTimestamp).getTime();
    const durationHours = (clockOutTs - clockInTs) / (1000 * 60 * 60);

    const empEntries = entries.filter(e => e.employeeId === editingShift.employee.id);
    const allSessions = processEntriesForEmployee(editingShift.employee, empEntries, paidBreakMinutes);
    const overlapSession = allSessions.find(session =>
      session.clockIn &&
      session.clockIn.getTime() !== clockInTs &&
      session.clockIn.getTime() > clockInTs &&
      session.clockIn.getTime() < clockOutTs
    );

    const showLongShiftWarning = (onConfirm: () => void) => {
      setShiftWarning({
        title: "Very Long Shift",
        description: `This shift would be ${durationHours.toFixed(1)} hours. Are you sure this is correct?`,
        actions: [
          { label: "Yes, Confirm", onClick: onConfirm },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
    };

    if (overlapSession) {
      const mergedClockOutTs = overlapSession.clockOut?.toISOString() ?? clockOutTimestamp;
      const mergedDurationHours = overlapSession.clockOut
        ? (overlapSession.clockOut.getTime() - clockInTs) / (1000 * 60 * 60)
        : durationHours;
      const overlapLabel = overlapSession.clockOut
        ? `${format(overlapSession.clockIn!, "HH:mm")} – ${format(overlapSession.clockOut, "HH:mm")}`
        : `${format(overlapSession.clockIn!, "HH:mm")} (still open)`;

      setShiftWarning({
        title: "Overlapping Shift Detected",
        description: `There is already a shift from ${overlapLabel} on the same day. Do you want to unite them into one session?`,
        actions: [
          {
            label: "Unite Shifts",
            onClick: () => {
              if (mergedDurationHours > 15) {
                setShiftWarning({
                  title: "Very Long Shift",
                  description: `The combined shift would be ${mergedDurationHours.toFixed(1)} hours. Are you sure this is correct?`,
                  actions: [
                    { label: "Yes, Confirm", onClick: () => doSave(mergedClockOutTs, overlapSession) },
                    { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
                  ],
                });
              } else {
                doSave(mergedClockOutTs, overlapSession);
              }
            },
          },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    if (durationHours > 15) {
      showLongShiftWarning(() => doSave(clockOutTimestamp, null));
      return;
    }

    doSave(clockOutTimestamp, null);
  };

  const handleSaveBreakEdit = () => {
    if (!editingBreak) return;

    // Validation: Break end must be after break start
    if (editBreakStart && editBreakEnd) {
      if (editBreakEnd <= editBreakStart) {
        toast({
          title: "Invalid Time",
          description: "Break end must be after break start.",
          variant: "destructive"
        });
        return;
      }
    }

    // Validation: Break must be within session
    if (viewingWorkday) {
      const clockIn = viewingWorkday.clockIn ? format(viewingWorkday.clockIn, "HH:mm") : null;
      const clockOut = viewingWorkday.clockOut ? format(viewingWorkday.clockOut, "HH:mm") : null;

      if (clockIn && (editBreakStart < clockIn || editBreakEnd < clockIn)) {
        toast({ title: "Invalid Time", description: "Break cannot start before clock in.", variant: "destructive" });
        return;
      }
      if (clockOut && (editBreakStart > clockOut || editBreakEnd > clockOut)) {
        toast({ title: "Invalid Time", description: "Break cannot end after clock out.", variant: "destructive" });
        return;
      }
    }

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

  const [addingNewBreak, setAddingNewBreak] = useState<EmployeeWorkday | null>(null);
  const [newBreakStartTime, setNewBreakStartTime] = useState<string>("");
  const [newBreakEndTime, setNewBreakEndTime] = useState<string>("");

  const handleAddNewBreak = () => {
    if (!addingNewBreak || !newBreakStartTime || !newBreakEndTime) return;
    if (!/^\d{2}:\d{2}$/.test(newBreakStartTime) || !/^\d{2}:\d{2}$/.test(newBreakEndTime)) return;
    const dateStr = addingNewBreak.entries.find(e => e.type === "clock-in")?.date || format(activeDay, "yyyy-MM-dd");
    addEntryMutation.mutate(
      { employeeId: addingNewBreak.employee.id, type: "break-start", date: dateStr, timestamp: new Date(`${dateStr}T${newBreakStartTime}:00`).toISOString() },
      {
        onSuccess: () => {
          addEntryMutation.mutate(
            { employeeId: addingNewBreak!.employee.id, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${newBreakEndTime}:00`).toISOString() },
            {
              onSuccess: () => {
                setAddingNewBreak(null); setNewBreakStartTime(""); setNewBreakEndTime(""); setSelectedWorkday(null);
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
    const dateStr = addingClockOut.entries.find(e => e.type === "clock-in")?.date || format(activeDay, "yyyy-MM-dd");
    addEntryMutation.mutate(
      { employeeId: addingClockOut.employee.id, type: "clock-out", date: dateStr, timestamp: new Date(`${dateStr}T${clockOutTime}:00`).toISOString() },
      {
        onSuccess: () => {
          setAddingClockOut(null); setClockOutTime(""); setSelectedWorkday(null);
          toast({ title: "Success", description: "Clock out added" });
        }
      }
    );
  };

  const handleAddClockOutClick = (emp: Employee, dateStr: string, clockIn: Date | null, selectedTime: string) => {
    if (!clockIn) return;
    const isOvernight = selectedTime < format(clockIn, "HH:mm");
    const clockOutDateStr = isOvernight ? format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd") : dateStr;
    const clockOutDateTime = new Date(`${clockOutDateStr}T${selectedTime}:00`);
    const clockOutTimestamp = clockOutDateTime.toISOString();
    const clockInTs = clockIn.getTime();
    const clockOutTs = clockOutDateTime.getTime();
    const durationHours = (clockOutTs - clockInTs) / (1000 * 60 * 60);

    const empEntries = entries.filter(e => e.employeeId === emp.id);
    const allSessions = processEntriesForEmployee(emp, empEntries, paidBreakMinutes);
    const overlapSession = allSessions.find(session =>
      session.clockIn &&
      session.clockIn.getTime() !== clockInTs &&
      session.clockIn.getTime() > clockInTs &&
      session.clockIn.getTime() < clockOutTs
    );

    const doAdd = (finalTs: string, mergeSession: EmployeeWorkday | null) => {
      addEntryMutation.mutate({ employeeId: emp.id, type: "clock-out", date: dateStr, timestamp: finalTs });
      if (mergeSession) mergeSession.entries.forEach(e => deleteEntryMutation.mutate(e.id));
      setShiftWarning(null);
    };

    if (overlapSession) {
      const mergedTs = overlapSession.clockOut?.toISOString() ?? clockOutTimestamp;
      const mergedHours = overlapSession.clockOut
        ? (overlapSession.clockOut.getTime() - clockInTs) / (1000 * 60 * 60)
        : durationHours;
      const label = overlapSession.clockOut
        ? `${format(overlapSession.clockIn!, "HH:mm")} – ${format(overlapSession.clockOut, "HH:mm")}`
        : `${format(overlapSession.clockIn!, "HH:mm")} (still open)`;

      setShiftWarning({
        title: "Overlapping Shift Detected",
        description: `There is already a shift from ${label}. Do you want to unite them into one session?`,
        actions: [
          {
            label: "Unite Shifts",
            onClick: () => {
              if (mergedHours > 15) {
                setShiftWarning({
                  title: "Very Long Shift",
                  description: `The combined shift would be ${mergedHours.toFixed(1)} hours. Are you sure?`,
                  actions: [
                    { label: "Yes, Confirm", onClick: () => doAdd(mergedTs, overlapSession) },
                    { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
                  ],
                });
              } else {
                doAdd(mergedTs, overlapSession);
              }
            },
          },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    if (durationHours > 15) {
      setShiftWarning({
        title: "Very Long Shift",
        description: `This shift would be ${durationHours.toFixed(1)} hours. Are you sure?`,
        actions: [
          { label: "Yes, Confirm", onClick: () => doAdd(clockOutTimestamp, null) },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    doAdd(clockOutTimestamp, null);
  };

  const handleAddTimesheet = async () => {
    if (!newTimesheetEmployeeId || !newTimesheetClockIn || !/^\d{2}:\d{2}$/.test(newTimesheetClockIn)) return;
    const dateStr = format(selectedDay, "yyyy-MM-dd");
    const empId = Number(newTimesheetEmployeeId);
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    const roleToSave = newTimesheetRole || undefined;

    const hasClockOut = !!(newTimesheetClockOut && /^\d{2}:\d{2}$/.test(newTimesheetClockOut));
    const isOvernight = hasClockOut && newTimesheetClockOut < newTimesheetClockIn;
    const clockOutDateStr = isOvernight ? format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd") : dateStr;
    const clockInTimestamp = new Date(`${dateStr}T${newTimesheetClockIn}:00`).toISOString();
    const clockOutTimestamp = hasClockOut
      ? new Date(`${clockOutDateStr}T${newTimesheetClockOut}:00`).toISOString()
      : null;

    const doAdd = async (finalClockOutTs: string | null, mergeSession: EmployeeWorkday | null) => {
      await addEntryMutation.mutateAsync({ employeeId: empId, type: "clock-in", date: dateStr, timestamp: clockInTimestamp, role: roleToSave });
      if (newTimesheetBreakStart && newTimesheetBreakEnd && /^\d{2}:\d{2}$/.test(newTimesheetBreakStart) && /^\d{2}:\d{2}$/.test(newTimesheetBreakEnd)) {
        await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-start", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetBreakStart}:00`).toISOString() });
        await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetBreakEnd}:00`).toISOString() });
      }
      if (finalClockOutTs) {
        await addEntryMutation.mutateAsync({ employeeId: empId, type: "clock-out", date: dateStr, timestamp: finalClockOutTs });
      }
      if (mergeSession) {
        mergeSession.entries.forEach(e => deleteEntryMutation.mutate(e.id));
      }
      toast({ title: "Success", description: "Timesheet added" });
      setAddingTimesheet(false);
      setShiftWarning(null);
      resetAddTimesheetForm();
    };

    if (!clockOutTimestamp) {
      const clockInTs = new Date(clockInTimestamp).getTime();
      const empEntries = entries.filter(e => e.employeeId === empId);
      const allSessions = processEntriesForEmployee(emp, empEntries, paidBreakMinutes);

      const openSession = allSessions.find(session =>
        session.clockIn &&
        (session.status === "working" || session.status === "on-break") &&
        session.clockIn.getTime() < clockInTs &&
        format(session.clockIn, "yyyy-MM-dd") === dateStr
      );
      const hasNewerSession = !openSession && allSessions.some(session =>
        session.clockIn && session.clockIn.getTime() > clockInTs
      );

      if (openSession) {
        const existingLabel = format(openSession.clockIn!, "HH:mm");
        const newLabel = format(new Date(clockInTimestamp), "HH:mm");
        setShiftWarning({
          title: "Session Already In Progress",
          description: `There is already an open session starting at ${existingLabel}. Adding another without a clock-out will leave both as 'Incomplete'.`,
          actions: [
            {
              label: `Close at ${newLabel} & Continue`,
              onClick: async () => {
                await addEntryMutation.mutateAsync({ employeeId: empId, type: "clock-out", date: dateStr, timestamp: clockInTimestamp });
                setShiftWarning(null);
                await doAdd(null, null);
              },
            },
            { label: "Add Anyway", variant: "outline", onClick: async () => { setShiftWarning(null); await doAdd(null, null); } },
            { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
          ],
        });
        return;
      }

      if (hasNewerSession) {
        setShiftWarning({
          title: "No Clock Out Time",
          description: "There are already newer sessions recorded for this employee. Without a clock-out, this session will be shown as 'Incomplete'. Would you like to add a clock-out time?",
          actions: [
            { label: "Add Clock Out", variant: "outline", onClick: () => setShiftWarning(null) },
            { label: "Leave as Incomplete", onClick: async () => { await doAdd(null, null); } },
            { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
          ],
        });
        return;
      }

      await doAdd(null, null);
      return;
    }

    const clockInTs = new Date(clockInTimestamp).getTime();
    const clockOutTs = new Date(clockOutTimestamp).getTime();
    const durationHours = (clockOutTs - clockInTs) / (1000 * 60 * 60);

    const empEntries = entries.filter(e => e.employeeId === empId);
    const allSessions = processEntriesForEmployee(emp, empEntries, paidBreakMinutes);
    const overlapSession = allSessions.find(session =>
      session.clockIn &&
      session.clockIn.getTime() > clockInTs &&
      session.clockIn.getTime() < clockOutTs
    );

    if (overlapSession) {
      const mergedClockOutTs = overlapSession.clockOut && overlapSession.clockOut.getTime() > clockOutTs
        ? overlapSession.clockOut.toISOString()
        : clockOutTimestamp;
      const mergedEndTs = overlapSession.clockOut ? Math.max(overlapSession.clockOut.getTime(), clockOutTs) : clockOutTs;
      const mergedDurationHours = (mergedEndTs - clockInTs) / (1000 * 60 * 60);
      const overlapLabel = overlapSession.clockOut
        ? `${format(overlapSession.clockIn!, "HH:mm")} – ${format(overlapSession.clockOut, "HH:mm")}`
        : `${format(overlapSession.clockIn!, "HH:mm")} (still open)`;

      setShiftWarning({
        title: "Overlapping Shift Detected",
        description: `There is already a shift from ${overlapLabel}. Do you want to unite them into one session?`,
        actions: [
          {
            label: "Unite Shifts",
            onClick: async () => {
              if (mergedDurationHours > 15) {
                setShiftWarning({
                  title: "Very Long Shift",
                  description: `The combined shift would be ${mergedDurationHours.toFixed(1)} hours. Are you sure this is correct?`,
                  actions: [
                    { label: "Yes, Confirm", onClick: async () => { await doAdd(mergedClockOutTs, overlapSession); } },
                    { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
                  ],
                });
              } else {
                await doAdd(mergedClockOutTs, overlapSession);
              }
            },
          },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    if (durationHours > 15) {
      setShiftWarning({
        title: "Very Long Shift",
        description: `This shift would be ${durationHours.toFixed(1)} hours. Are you sure this is correct?`,
        actions: [
          { label: "Yes, Confirm", onClick: async () => { await doAdd(clockOutTimestamp, null); } },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    await doAdd(clockOutTimestamp, null);
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

  const WorkdayCard = ({ sessions, date }: { sessions: EmployeeWorkday[]; date: Date }) => {
    const emp = sessions[0].employee;
    const totalNet = sessions.reduce((s, w) => s + w.netWorkedMinutes, 0);
    const isSingle = sessions.length === 1;

    return (
      <div
        className="w-full flex items-center gap-3 p-3 rounded-md border bg-card hover-elevate text-left"
        data-testid={`timesheet-card-${emp.id}`}
      >
        <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />
        <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 border-r pr-3 min-w-[80px]">
              <span className="text-xs font-semibold truncate block">{emp.name}</span>
              <span className="text-[10px] text-muted-foreground">{emp.role || "No Role"}</span>
            </div>
            <div className="flex items-center gap-4 flex-nowrap">
              {sessions.map((wd, idx) => {
                const sc = statusConfig[wd.status];
                return (
                  <button
                    key={`${wd.employee.id}-${wd.clockIn?.getTime()}-${idx}`}
                    onClick={() => { setViewingWorkdayManual(wd, date); }}
                    className={`flex items-center gap-3 flex-shrink-0 cursor-pointer hover:bg-muted/50 rounded px-2 py-1 transition-colors ${!isSingle && idx > 0 ? "border-l pl-4" : ""}`}
                  >
                    <div className="flex flex-col items-center">
                      <div className="w-1.5 h-1.5 rounded-full mb-1" style={{ backgroundColor: sc.color }} />
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-bold whitespace-nowrap">
                          {wd.clockIn ? format(wd.clockIn, "HH:mm") : "--:--"} - {wd.clockOut ? format(wd.clockOut, "HH:mm") : "—"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground">{wd.status === "incomplete" ? "—" : `${formatHoursDecimal(wd.netWorkedMinutes)}h`}</span>
                          {wd.hasUnfinishedBreak && (
                            <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1 rounded">Unfinished break</span>
                          )}
                          {!wd.hasUnfinishedBreak && wd.status === "completed" && wd.totalBreakMinutes === 0 && wd.netWorkedMinutes >= 375 && (
                            <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1 rounded">No break</span>
                          )}
                          {!wd.hasUnfinishedBreak && wd.totalBreakMinutes > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              (Break {formatMinutes(wd.totalBreakMinutes)}
                              {wd.unpaidBreakMinutes > 0 && <span className="text-red-500 ml-0.5">-{formatMinutes(wd.unpaidBreakMinutes)}</span>})
                            </span>
                          )}
                          {(() => {
                            const entryDate = wd.entries.find(e => e.type === "clock-in")?.date;
                            if (!entryDate) return null;
                            const hasPending = approvalRequests.some(ar => ar.employeeId === wd.employee.id && ar.entryDate === entryDate && ar.status === "pending");
                            const hasNotes = wd.entries.some(e => e.notes);
                            return (
                              <>
                                {hasPending && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Pending approval" />}
                                {hasNotes && <StickyNote className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <span className="text-xs font-bold text-muted-foreground ml-auto flex-shrink-0 pl-2">{formatHoursDecimal(totalNet)} h</span>
          </div>
        </div>
      </div>
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-4 p-4 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight" data-testid="text-timesheets-title">Timesheets</h2>
          </div>
          <Button
            variant="default"
            size="sm"
            className="font-bold shadow-sm gap-1.5 px-4 h-9 bg-primary hover:bg-primary/90"
            onClick={() => setAddingTimesheet(true)}
            data-testid="button-add-timesheet"
          >
            <Plus className="w-4 h-4" /> Add Timesheet
          </Button>
        </div>

        <div className="flex flex-col gap-3 bg-background rounded-lg border p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
              <Button
                variant={viewMode === "week" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider"
                onClick={() => setViewMode("week")}
              >
                Day
              </Button>
              <Button
                variant={viewMode === "month" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider"
                onClick={() => setViewMode("month")}
              >
                Month
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs font-semibold gap-1.5"
              onClick={() => {
                setExportSelectedEmployeeIds(employees.map(e => e.id));
                setExportDialogOpen(true);
              }}
              data-testid="button-export-pdf"
            >
              <FileDown className="w-3.5 h-3.5" /> Export PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs relative"
              onClick={() => setCsvImporterOpen(true)}
              data-testid="button-import-csv"
            >
              <FileUp className="w-3.5 h-3.5" /> Import CSV
              <span className="ml-1 text-[9px] font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded px-1 py-0.5 leading-none">Experimental</span>
            </Button>
          </div>

          <div className="flex items-center justify-between border-t pt-2 mt-1">
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
                  : format(selectedMonth, "MMMM yyyy")}
              </span>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => viewMode === "week" ? navigateWeek(1) : navigateMonth(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-auto">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <div className="flex flex-col gap-1.5 flex-1 sm:flex-none sm:w-[150px]">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">Position / Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="w-full h-9 text-sm" data-testid="select-role-filter">
                  <SelectValue placeholder="All Positions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {customRoles.map(role => (
                    <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 flex-1 sm:flex-none sm:w-[180px]">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">Employee</Label>
              <Select
                value={employeeSearch === "" ? "all" : employeeSearch}
                onValueChange={(val) => setEmployeeSearch(val === "all" ? "" : val)}
              >
                <SelectTrigger className="w-full h-9 text-sm" data-testid="select-employee-filter">
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
            </div>
          </div>
        </div>

        {viewMode === "week" && (
          <div className="grid grid-cols-7 gap-1.5">
            {weekDays.map(day => {
              const dayIsToday = isToday(day);
              const dayIsSelected = isSameDay(day, selectedDay);
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDay(day)}
                  className={`flex flex-col items-center justify-center py-2 rounded-xl transition-all
                    ${dayIsSelected ? "bg-primary text-primary-foreground shadow-md scale-105" : dayIsToday ? "bg-primary/10" : "bg-muted/50 hover:bg-muted"}`}
                  data-testid={`button-day-${format(day, "EEE").toLowerCase()}`}
                >
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${dayIsSelected ? "opacity-80" : "text-muted-foreground"}`}>
                    {format(day, "EEE")}
                  </span>
                  <span className="text-lg font-black">{format(day, "d")}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-3 pb-20">
          {viewMode === "week" ? (
            workdays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 italic text-sm">
                <Calendar className="w-8 h-8 mb-2 opacity-20" />
                <p>No entries for this day</p>
              </div>
            ) : (
              (() => {
                const grouped = new Map<number, EmployeeWorkday[]>();
                workdays.forEach(wd => {
                  const list = grouped.get(wd.employee.id) || [];
                  list.push(wd);
                  grouped.set(wd.employee.id, list);
                });
                return Array.from(grouped.entries()).map(([empId, sessions]) => (
                  <WorkdayCard key={empId} sessions={sessions} date={selectedDay} />
                ));
              })()
            )
          ) : (
            monthWorkdays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 italic text-sm">
                <Calendar className="w-8 h-8 mb-2 opacity-20" />
                <p>No entries for this month</p>
              </div>
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
                  {(() => {
                    const grouped = new Map<number, EmployeeWorkday[]>();
                    dayWds.forEach(wd => {
                      const list = grouped.get(wd.employee.id) || [];
                      list.push(wd);
                      grouped.set(wd.employee.id, list);
                    });
                    return Array.from(grouped.entries()).map(([empId, sessions]) => (
                      <WorkdayCard key={empId} sessions={sessions} date={date} />
                    ));
                  })()}
                </div>
              ))
            )
          )}
        </div>
      </div>

      {(viewMode === "week" ? workdays.length > 0 : monthWorkdays.length > 0) && (
        <div className="border-t bg-background sticky bottom-0 z-10 px-4 py-3 flex items-center justify-end gap-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
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
          <div className="flex justify-end pt-4">
            <Button 
              onClick={handleExportPDF} 
              disabled={isExporting || exportSelectedEmployeeIds.length === 0}
              className="w-full sm:w-auto px-8 gap-2"
            >
              <FileDown className="w-4 h-4" />
              {isExporting ? "Generating..." : "Download PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!viewingWorkday} onOpenChange={(open) => { 
        if (!open) {
          setSelectedWorkday(null); 
          setViewingDate(null); 
          setConfirmDelete(false);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Timesheet Details</DialogTitle></DialogHeader>
          {viewingWorkday && (() => {
            const { employee: emp, entries: dayEntries, clockIn, clockOut, netWorkedMinutes, totalBreakMinutes, unpaidBreakMinutes, hasUnfinishedBreak, status } = viewingWorkday;
            const sc = statusConfig[status];
            return (
              <div className="space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b pb-4 mb-2">
                  <div className="flex items-center gap-3">
                    <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-lg leading-tight">{emp.name}</div>
                      <div className="text-xs text-muted-foreground">{emp.role || "No Role"}</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 sm:items-end w-full sm:w-auto">
                    <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Role for this shift</div>
                    <Select
                      value={dayEntries.find(e => e.type === "clock-in")?.role || emp.role || "none"}
                      onValueChange={(val) => {
                        const actualVal = val === "none" ? "" : val;
                        const clockInEntry = dayEntries.find(e => e.type === "clock-in");
                        if (clockInEntry) {
                          updateEntryMutation.mutate({ id: clockInEntry.id, timestamp: new Date(clockInEntry.timestamp).toISOString(), role: actualVal });
                        }
                      }}
                    >
                      <SelectTrigger className="w-full sm:w-[140px] h-8 text-xs bg-background" data-testid="select-detail-role">
                        <SelectValue placeholder="Set role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-muted-foreground italic">No Role</SelectItem>
                        {customRoles.map(r => (
                          <SelectItem key={r.id} value={r.name}>
                            <span className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: r.color }} />
                              {r.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {customRoles.length === 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <AlertCircle className="w-3 h-3 text-amber-500" />
                          <span>No roles created yet</span>
                        </div>
                        <button 
                          className="text-[10px] text-primary hover:underline font-medium"
                          onClick={() => {
                            setViewingWorkday(null);
                            setLocation("/settings");
                          }}
                        >
                          Add in Settings
                        </button>
                      </div>
                    )}
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
                    {status === "incomplete" ? (
                      <div className="font-medium text-muted-foreground">— (no clock-out)</div>
                    ) : (
                      <div className="font-medium">{formatMinutes(netWorkedMinutes)} ({formatHoursDecimal(netWorkedMinutes)} h)</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Break</div>
                    {(() => {
                      const noBreakWarning = !hasUnfinishedBreak && status === "completed" && totalBreakMinutes === 0 && netWorkedMinutes >= 375;
                      return (
                        <div className={`font-medium flex items-center gap-1.5 ${hasUnfinishedBreak || noBreakWarning ? "text-amber-600 dark:text-amber-400" : ""}`}>
                          {hasUnfinishedBreak
                            ? "Unfinished break"
                            : totalBreakMinutes > 0
                              ? formatMinutes(totalBreakMinutes)
                              : noBreakWarning
                                ? `No break · ${formatHoursDecimal(netWorkedMinutes)}h worked`
                                : "No break"}
                        </div>
                      );
                    })()}
                    {unpaidBreakMinutes > 0 && (
                      <div className="text-[11px] text-red-500">-{formatMinutes(unpaidBreakMinutes)} deducted</div>
                    )}
                  </div>
                </div>
                {(() => {
                  const clockInEntry = dayEntries.find(e => e.type === "clock-in");
                  const clockOutEntry = dayEntries.find(e => e.type === "clock-out");
                  const dateStr = clockInEntry?.date || format(activeDay, "yyyy-MM-dd");
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
                              onClick={() => openClock(clockIn ? format(clockIn, "HH:mm") : format(new Date(), "HH:mm"), (v) => {
                                handleAddClockOutClick(emp, dateStr, clockIn, v);
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
                  const dateStr = dayEntries.find(e => e.type === "clock-in")?.date as string || format(activeDay, "yyyy-MM-dd");
                  const sortedEntries = [...dayEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                  const breakPairs: { start: TimeEntry; end: TimeEntry | null }[] = [];
                  let pendingStart: TimeEntry | null = null;
                  for (const e of sortedEntries) {
                    if (e.type === "break-start") { pendingStart = e; }
                    else if (e.type === "break-end" && pendingStart) { breakPairs.push({ start: pendingStart, end: e }); pendingStart = null; }
                  }
                  if (pendingStart) breakPairs.push({ start: pendingStart, end: null });
                  if (breakPairs.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      {breakPairs.map((bp, idx) => (
                        <div key={bp.start.id} className="rounded-md border p-3 text-sm">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Break {breakPairs.length > 1 ? idx + 1 : ""}</span>
                              {bp.start && !bp.end && (
                                <span className="text-[10px] bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium" data-testid={`status-unfinished-break-${idx}`}>Unfinished</span>
                              )}
                              <button
                                className={`text-[10px] px-1.5 py-0.5 rounded font-medium border transition-colors ${bp.start.isUnpaid ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800" : "bg-muted text-muted-foreground border-border hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 hover:border-red-200"}`}
                                title={bp.start.isUnpaid ? "Marked as unpaid — click to toggle" : "Mark as unpaid break"}
                                onClick={() => apiRequest("PATCH", `/api/steepin/entries/${bp.start.id}`, { isUnpaid: !bp.start.isUnpaid }).then(() => queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] }))}
                                data-testid={`button-toggle-unpaid-${idx}`}
                              >
                                {bp.start.isUnpaid ? "Unpaid" : "Paid"}
                              </button>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6"
                                onClick={() => {
                                  setEditingBreak({ start: bp.start, end: bp.end });
                                  setEditBreakStart(format(new Date(bp.start.timestamp), "HH:mm"));
                                  setEditBreakEnd(bp.end ? format(new Date(bp.end.timestamp), "HH:mm") : "");
                                }}
                                data-testid={`button-edit-break-${idx}`}
                              >
                                <Edit2 className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                                onClick={() => {
                                  if (confirm("Delete this break?")) {
                                    deleteEntryMutation.mutate(bp.start.id);
                                    if (bp.end) deleteEntryMutation.mutate(bp.end.id);
                                  }
                                }}
                                data-testid={`button-delete-break-${idx}`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                              {!bp.end && (
                                <Button variant="outline" size="sm" className="h-6 text-xs px-2"
                                  onClick={() => openClock(format(new Date(), "HH:mm"), (v) => {
                                    addEntryMutation.mutate({ employeeId: emp.id, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${v}:00`).toISOString() });
                                  })}
                                  data-testid={`button-add-break-end-${idx}`}
                                >
                                  <Plus className="w-3 h-3 mr-1" /> Add End
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="text-xs text-muted-foreground mb-0.5">Start</div>
                              <div className="font-medium font-mono">{format(new Date(bp.start.timestamp), "HH:mm")}</div>
                            </div>
                            <div className="text-muted-foreground mt-3">→</div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-0.5">End</div>
                              <div className="font-medium font-mono">{bp.end ? format(new Date(bp.end.timestamp), "HH:mm") : "—"}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {clockOut && (() => {
                  // Only show for the last completed session AND only if the employee has no open session
                  const allEmpEntries = entries.filter(e => e.employeeId === emp.id);
                  const allSessions = processEntriesForEmployee(emp, allEmpEntries, paidBreakMinutes);
                  const hasOpenSession = allSessions.some(s => s.status === "working" || s.status === "on-break");
                  if (hasOpenSession) return null;
                  const lastCompleted = allSessions
                    .filter(s => s.status === "completed" && s.clockOut)
                    .reduce<EmployeeWorkday | null>((last, s) => {
                      if (!last || s.clockOut! > last.clockOut!) return s;
                      return last;
                    }, null);
                  if (!lastCompleted || lastCompleted.clockIn?.getTime() !== clockIn?.getTime()) return null;
                  return (
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                        onClick={() => {
                          // Always read the freshest entries at click time — avoids stale closure issues
                          const freshEntries = (viewingWorkday?.entries ?? dayEntries);
                          const freshClockOut = [...freshEntries]
                            .filter(e => e.type === "clock-out")
                            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                            .pop();
                          if (!freshClockOut) return;
                          // Gap = time between the clock-out TIME they recorded and right now
                          const gapMinutes = differenceInMinutes(new Date(), new Date(freshClockOut.timestamp));
                          if (gapMinutes > 10) {
                            setReopenGapDialog({
                              clockOutEntry: freshClockOut,
                              gapMinutes,
                              employeeId: emp.id,
                              clockOutDate: freshClockOut.date as string,
                            });
                          } else {
                            deleteEntryMutation.mutate(freshClockOut.id);
                          }
                        }}
                        disabled={deleteEntryMutation.isPending || reopenShiftMutation.isPending}
                        data-testid="button-reopen-shift"
                      >
                        <Trash2 className="w-3 h-3 mr-1" /> Reopen Shift
                      </Button>
                    </div>
                  );
                })()}

                {dayEntries.some(e => e.notes) && (
                  <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <StickyNote className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Notes</span>
                    </div>
                    <div className="space-y-1.5">
                      {dayEntries.filter(e => e.notes).map(e => {
                        const typeLabel = e.type === "clock-in" ? "Clock In" : e.type === "clock-out" ? "Clock Out" : e.type === "break-start" ? "Break Start" : "Break End";
                        return (
                          <div key={e.id} className="text-xs" data-testid={`note-entry-${e.id}`}>
                            <span className="font-medium text-blue-600 dark:text-blue-400">{typeLabel}:</span>{" "}
                            <span className="text-muted-foreground">{e.notes}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(() => {
                  const dateStr = dayEntries.find(e => e.type === "clock-in")?.date || format(activeDay, "yyyy-MM-dd");
                  const pendingApprovals = approvalRequests.filter(
                    ar => ar.employeeId === emp.id && ar.entryDate === dateStr && ar.status === "pending"
                  );
                  if (pendingApprovals.length === 0) return null;
                  return (
                    <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Pending Approvals</span>
                      </div>
                      {pendingApprovals.map(ar => {
                        const data = JSON.parse(ar.requestData || "{}");
                        const label = data.action === "break" ? "Count gap as break time" : "Count gap as working time";
                        return (
                          <div key={ar.id} className="space-y-2" data-testid={`approval-request-${ar.id}`}>
                            <p className="text-xs text-muted-foreground">
                              {emp.name} requested: <strong>{label}</strong>
                              {data.minutesGap ? ` (${data.minutesGap} min gap)` : ""}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="h-7 text-xs flex-1"
                                onClick={() => approvalMutation.mutate({ id: ar.id, status: "approved" })}
                                disabled={approvalMutation.isPending}
                                data-testid={`button-approve-${ar.id}`}
                              >
                                <Check className="w-3 h-3 mr-1" /> Approve
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs flex-1"
                                onClick={() => approvalMutation.mutate({ id: ar.id, status: "rejected" })}
                                disabled={approvalMutation.isPending}
                                data-testid={`button-reject-${ar.id}`}
                              >
                                Reject
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <Button variant="outline" size="sm" className="w-full"
                  onClick={() => {
                    const dateStr = dayEntries.find(e => e.type === "clock-in")?.date || format(activeDay, "yyyy-MM-dd");
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

                <div className="pt-2 border-t">
                  {!confirmDelete ? (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(true)}
                      data-testid="button-delete-timesheet-init"
                    >
                      Delete Timesheet
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] text-center text-muted-foreground font-medium">Are you sure? This will delete this timesheet entry.</p>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1 h-8"
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancel
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm" 
                          className="flex-1 h-8"
                          disabled={deleteTimesheetMutation.isPending}
                          onClick={() => {
                            const date = dayEntries.find(e => e.type === "clock-in")?.date as string || format(activeDay, "yyyy-MM-dd");
                            deleteTimesheetMutation.mutate({ employeeId: emp.id, date, entries: dayEntries });
                          }}
                          data-testid="button-delete-timesheet-confirm"
                        >
                          {deleteTimesheetMutation.isPending ? "Deleting..." : "Confirm Delete"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
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
              <div className="text-sm text-muted-foreground">{editingShift.employee.name} — {(() => { const d = editingShift.entries.find(e => e.type === "clock-in")?.date; return d ? format(new Date(d + "T00:00:00"), "EEE, MMM d, yyyy") : format(activeDay, "EEE, MMM d, yyyy"); })()}</div>
              <div className="space-y-2">
                <Label>Clock In / Clock Out</Label>
                <TimeRangeInput startValue={editShiftClockIn} endValue={editShiftClockOut} onStartChange={setEditShiftClockIn} onEndChange={setEditShiftClockOut} startTestId="input-edit-shift-clock-in" endTestId="input-edit-shift-clock-out" />
                {/^\d{2}:\d{2}$/.test(editShiftClockOut) && editShiftClockOut < editShiftClockIn && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Overnight shift — clock out will be saved as the next day.</p>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button 
              onClick={handleSaveShiftEdit} 
              disabled={updateEntryMutation.isPending || !/^\d{2}:\d{2}$/.test(editShiftClockIn)} 
              className="w-full sm:w-auto px-8"
              data-testid="button-save-shift-edit"
            >
              Save
            </Button>
          </div>
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
          <div className="flex justify-end pt-2">
            <Button 
              onClick={handleSaveBreakEdit} 
              disabled={updateEntryMutation.isPending} 
              className="w-full sm:w-auto px-8"
              data-testid="button-save-break-edit"
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Shift Warning / Confirmation Dialog */}
      <Dialog open={!!shiftWarning} onOpenChange={(open) => { if (!open) setShiftWarning(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{shiftWarning?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">{shiftWarning?.description}</p>
          <div className="flex flex-col gap-2 pt-2">
            {shiftWarning?.actions.map((action, i) => (
              <Button
                key={i}
                variant={action.variant || "default"}
                onClick={action.onClick}
                data-testid={`button-shift-warning-action-${i}`}
              >
                {action.label}
              </Button>
            ))}
          </div>
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
      <Dialog 
        open={addingTimesheet} 
        onOpenChange={(open) => {
          setAddingTimesheet(open);
          if (!open) resetAddTimesheetForm();
        }}
      >
        <DialogContent>
          <DialogHeader><DialogTitle>Add Missing Timesheet</DialogTitle></DialogHeader>
          {employees.filter(e => e.status === "active").length === 0 ? (
            <div className="py-6 flex flex-col items-center text-center">
              <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No employees found</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-[300px]">
                You need to add at least one employee before you can create a timesheet.
              </p>
              <Button 
                onClick={() => {
                  setAddingTimesheet(false);
                  setLocation("/employees");
                }}
              >
                Go to Employees
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-4">
                <div className="text-sm text-muted-foreground">{format(selectedDay, "EEEE, MMM d, yyyy")}</div>
                <div className="space-y-2">
                  <Label>Employee for this timesheet</Label>
                  <Select
                    value={newTimesheetEmployeeId}
                    onValueChange={(val) => {
                      setNewTimesheetEmployeeId(val);
                      const emp = employees.find(e => String(e.id) === val);
                      if (emp?.role) setNewTimesheetRole(emp.role);
                    }}
                  >
                    <SelectTrigger data-testid="select-timesheet-employee">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.filter(e => e.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(emp => (
                        <SelectItem key={emp.id} value={String(emp.id)}>
                          <span className="flex items-center gap-2">
                            {emp.role && customRoles.find(r => r.name === emp.role) && (
                              <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: customRoles.find(r => r.name === emp.role)!.color }} />
                            )}
                            {emp.name}
                            {emp.role && <span className="text-muted-foreground text-xs">{emp.role}</span>}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Role for this timesheet</Label>
                  <Select value={newTimesheetRole || "none"} onValueChange={(v) => setNewTimesheetRole(v === "none" ? "" : v)}>
                    <SelectTrigger data-testid="select-timesheet-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-muted-foreground italic">Default Employee Role</SelectItem>
                      {customRoles.map(r => (
                        <SelectItem key={r.id} value={r.name}>
                          <span className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: r.color }} />
                            {r.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {customRoles.length === 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
                      <AlertCircle className="w-3 h-3 text-amber-500" />
                      No roles created yet. 
                      <button 
                        className="text-primary hover:underline font-medium"
                        onClick={() => {
                          setAddingTimesheet(false);
                          setLocation("/settings");
                        }}
                      >
                        Add in Settings
                      </button>
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Shift Time</Label>
                  <TimeRangeInput startValue={newTimesheetClockIn} endValue={newTimesheetClockOut} onStartChange={setNewTimesheetClockIn} onEndChange={setNewTimesheetClockOut} startTestId="input-timesheet-clock-in" endTestId="input-timesheet-clock-out" />
                  {/^\d{2}:\d{2}$/.test(newTimesheetClockOut) && newTimesheetClockOut < newTimesheetClockIn
                    ? <p className="text-xs text-amber-600 dark:text-amber-400">Overnight shift — clock out will be saved as the next day.</p>
                    : <p className="text-xs text-muted-foreground">Clock out is optional</p>
                  }
                </div>
                <div className="space-y-2">
                  <Label>Break <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <TimeRangeInput startValue={newTimesheetBreakStart} endValue={newTimesheetBreakEnd} onStartChange={setNewTimesheetBreakStart} onEndChange={setNewTimesheetBreakEnd} startTestId="input-timesheet-break-start" endTestId="input-timesheet-break-end" />
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <Button 
                  onClick={handleAddTimesheet} 
                  disabled={addEntryMutation.isPending || !newTimesheetEmployeeId || !/^\d{2}:\d{2}$/.test(newTimesheetClockIn)} 
                  className="w-full sm:w-auto px-8"
                  data-testid="button-save-timesheet"
                >
                  Add Timesheet
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <CsvImporter
        open={csvImporterOpen}
        onClose={() => setCsvImporterOpen(false)}
        employees={employees}
      />

      {/* Reopen Shift — Gap Time Dialog */}
      <Dialog open={!!reopenGapDialog} onOpenChange={(open) => { if (!open) setReopenGapDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reopen Shift</DialogTitle>
          </DialogHeader>
          {reopenGapDialog && (() => {
            const { clockOutEntry, gapMinutes, employeeId, clockOutDate } = reopenGapDialog;
            const gapHours = Math.floor(gapMinutes / 60);
            const gapMins = gapMinutes % 60;
            const gapLabel = gapHours > 0 ? `${gapHours}h ${gapMins}m` : `${gapMins}m`;
            const clockOutTime = format(new Date(clockOutEntry.timestamp), "HH:mm");
            const nowTime = format(new Date(), "HH:mm");
            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The shift closed at <span className="font-medium text-foreground">{clockOutTime}</span> and it is now <span className="font-medium text-foreground">{nowTime}</span> — a gap of <span className="font-medium text-foreground">{gapLabel}</span>.
                  How should this time be counted?
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-3 px-4"
                    disabled={reopenShiftMutation.isPending}
                    onClick={() => reopenShiftMutation.mutate({ clockOutEntryId: clockOutEntry.id, employeeId, clockOutDate, clockOutTimestamp: clockOutEntry.timestamp as string, gapOption: "break" })}
                    data-testid="button-reopen-as-break"
                  >
                    <div className="text-left">
                      <div className="font-medium text-sm">Add as Break</div>
                      <div className="text-xs text-muted-foreground">The {gapLabel} gap is logged as a break</div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-3 px-4"
                    disabled={reopenShiftMutation.isPending}
                    onClick={() => reopenShiftMutation.mutate({ clockOutEntryId: clockOutEntry.id, employeeId, clockOutDate, clockOutTimestamp: clockOutEntry.timestamp as string, gapOption: "unpaid-break" })}
                    data-testid="button-reopen-as-unpaid-break"
                  >
                    <div className="text-left">
                      <div className="font-medium text-sm">Add as Unpaid Break</div>
                      <div className="text-xs text-muted-foreground">Logged as a break, fully deducted from pay</div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-3 px-4"
                    disabled={reopenShiftMutation.isPending}
                    onClick={() => reopenShiftMutation.mutate({ clockOutEntryId: clockOutEntry.id, employeeId, clockOutDate, clockOutTimestamp: clockOutEntry.timestamp as string, gapOption: "worked" })}
                    data-testid="button-reopen-as-worked"
                  >
                    <div className="text-left">
                      <div className="font-medium text-sm">Count as Paid Time</div>
                      <div className="text-xs text-muted-foreground">The {gapLabel} gap counts as worked time</div>
                    </div>
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setReopenGapDialog(null)} disabled={reopenShiftMutation.isPending}>
                  Cancel
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
