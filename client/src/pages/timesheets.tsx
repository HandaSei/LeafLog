import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isSameDay,
  differenceInMinutes, startOfMonth, endOfMonth, addMonths, subMonths, addDays, parseISO,
} from "date-fns";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Edit2, Plus, Coffee, Search, FileDown, FileUp, Calendar, CalendarDays, Check, AlertCircle, StickyNote, Trash2, Clock as ClockIcon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { WorkdayCard } from "@/components/timesheets/workday-card";
import { TimeInput, TimeRangeInput, ClockPickerDialog } from "@/components/time-input";
import { DateInput } from "@/components/date-input";
import CsvImporter from "@/components/csv-importer";
import { exportTimesheetPDF } from "@/lib/reports/timesheet-pdf";
import type { Employee, TimeEntry, CustomRole, ApprovalRequest, Shift } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/pay-utils";
import {
  createEntryRequest,
  deleteEntriesBatchRequest,
  deleteEntryRequest,
  updateEntryRequest,
} from "@/lib/timesheets/entry-api";
import { createTimesheetEntryCache } from "@/lib/timesheets/entry-cache";
import { useTimesheetViewModel } from "@/lib/timesheets/use-timesheet-view-model";
import {
  formatHoursDecimal,
  formatMinutes,
  getBreakPairs,
  getRelevantSessions,
  normalizeEntryDates,
  processEntriesForEmployee,
  STALE_OPEN_SESSION_MINUTES,
  toEntryDateString,
  toEntryTimestampIso,
  type EmployeeWorkday,
} from "@/lib/timesheets/session-engine";

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
  const [noteEditor, setNoteEditor] = useState<{ entry: TimeEntry; value: string } | null>(null);
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
  const [deletingClockOut, setDeletingClockOut] = useState<{
    entry: TimeEntry;
    employee: Employee;
    impact: "active" | "stale-incomplete" | "newer-incomplete";
    nextClockIn: TimeEntry | null;
    clockIn: Date | null;
  } | null>(null);
  const [editingBreak, setEditingBreak] = useState<{ start: TimeEntry | null, end: TimeEntry | null } | null>(null);
  const [editBreakStart, setEditBreakStart] = useState<string>("");
  const [editBreakEnd, setEditBreakEnd] = useState<string>("");
  const [deletingBreak, setDeletingBreak] = useState<{ start: TimeEntry; end: TimeEntry | null } | null>(null);
  const [breakOverlapWarning, setBreakOverlapWarning] = useState<{ conflicting: { start: TimeEntry; end: TimeEntry | null } } | null>(null);
  const [shiftWarning, setShiftWarning] = useState<{
    title: string;
    description: string;
    actions: { label: string; variant?: "default" | "destructive" | "outline"; onClick: () => void }[];
  } | null>(null);
  const [mergeDialog, setMergeDialog] = useState<{
    conflictSession: EmployeeWorkday;
    mergedClockOutTs: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportSelectedEmployeeIds, setExportSelectedEmployeeIds] = useState<number[]>([]);
  const [exportStartDate, setExportStartDate] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [exportEndDate, setExportEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [exportShowScheduled, setExportShowScheduled] = useState(false);
  const [csvImporterOpen, setCsvImporterOpen] = useState(false);
  const [reopenGapDialog, setReopenGapDialog] = useState<{ clockOutEntry: TimeEntry; gapMinutes: number; employeeId: number; clockOutDate: string } | null>(null);
  const { toast } = useToast();

  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekDays = useMemo(() => eachDayOfInterval({ start: selectedWeek, end: weekEnd }), [selectedWeek]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);
  const entriesFrom = format(addDays(viewMode === "week" ? selectedWeek : selectedMonth, -1), "yyyy-MM-dd");
  const entriesTo = format(addDays(viewMode === "week" ? weekEnd : monthEnd, 1), "yyyy-MM-dd");
  const {
    invalidateVisibleEntries,
    replaceEntryInCaches,
    upsertEntryInVisibleCaches,
    removeEntriesFromCaches,
  } = useMemo(() => createTimesheetEntryCache(entriesFrom, entriesTo), [entriesFrom, entriesTo]);

  const { data: customRoles = [] } = useQuery<CustomRole[]>({ queryKey: ["/api/roles"] });
  const { data: employees = [], isLoading: empsLoading, isFetching: empsFetching } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: entries = [], isLoading: entriesLoading, isFetching: entriesFetching } = useQuery<TimeEntry[]>({
    queryKey: ["/api/steepin/entries", "range", entriesFrom, entriesTo],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/steepin/entries?from=${entriesFrom}&to=${entriesTo}`);
      return res.json();
    },
  });
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
      invalidateVisibleEntries();
      toast({ title: "Success", description: "Approval request updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateEntryMutation = useMutation({
    mutationFn: updateEntryRequest,
    onSuccess: (entry: TimeEntry) => {
      replaceEntryInCaches(entry);
      invalidateVisibleEntries();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addEntryMutation = useMutation({
    mutationFn: createEntryRequest,
    onSuccess: (entry: TimeEntry) => {
      upsertEntryInVisibleCaches(entry);
      invalidateVisibleEntries();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: deleteEntryRequest,
    onSuccess: (_data, id) => {
      removeEntriesFromCaches([id]);
      invalidateVisibleEntries();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteEntriesBatchMutation = useMutation({
    mutationFn: deleteEntriesBatchRequest,
    onSuccess: (ids) => {
      removeEntriesFromCaches(ids);
      invalidateVisibleEntries();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reopenShiftMutation = useMutation({
    mutationFn: async ({ clockOutEntryId, employeeId, clockOutDate, clockOutTimestamp, gapOption }: {
      clockOutEntryId: number; employeeId: number; clockOutDate: string; clockOutTimestamp: string; gapOption: "break" | "unpaid-break" | "worked" | "none";
    }) => {
      const createdEntries: TimeEntry[] = [];
      const deletedEntryIds: number[] = [];
      if (gapOption === "break" || gapOption === "unpaid-break") {
        const isUnpaid = gapOption === "unpaid-break";
        createdEntries.push(await createEntryRequest({ employeeId, type: "break-start", date: clockOutDate, timestamp: clockOutTimestamp, isUnpaid }));
        const nowIso = new Date().toISOString();
        createdEntries.push(await createEntryRequest({ employeeId, type: "break-end", date: clockOutDate, timestamp: nowIso }));
      }
      deletedEntryIds.push(await deleteEntryRequest(clockOutEntryId));
      createdEntries.push(await createEntryRequest({ employeeId, type: "shift-reopened", date: clockOutDate, timestamp: new Date().toISOString() }));
      return { createdEntries, deletedEntryIds };
    },
    onSuccess: ({ createdEntries, deletedEntryIds }) => {
      removeEntriesFromCaches(deletedEntryIds);
      createdEntries.forEach(upsertEntryInVisibleCaches);
      invalidateVisibleEntries();
      setReopenGapDialog(null);
      toast({ title: "Shift reopened", description: "The clock-out has been removed and the shift is now in progress." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteTimesheetMutation = useMutation({
    mutationFn: async (data: { employeeId: number; date: string; entries: TimeEntry[] }) => {
      const ids = data.entries.map(e => e.id);
      return deleteEntriesBatchRequest(ids);
    },
    onSuccess: (ids) => {
      removeEntriesFromCaches(ids);
      invalidateVisibleEntries();
      toast({ title: "Success", description: "Timesheet deleted successfully" });
      setSelectedWorkday(null);
      setViewingDate(null);
      setConfirmDelete(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const getClockOutDeletePreview = (entry: TimeEntry, employee: Employee, clockIn: Date | null) => {
    const entryTime = new Date(entry.timestamp).getTime();
    const employeeEntries = rawEmployeeEntriesById.get(employee.id) || [];
    const nextClockIn = employeeEntries
      .filter(e => e.type === "clock-in" && new Date(e.timestamp).getTime() > entryTime)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0] || null;
    const clockInAgeMinutes = clockIn ? differenceInMinutes(new Date(), clockIn) : STALE_OPEN_SESSION_MINUTES + 1;
    const impact: "active" | "stale-incomplete" | "newer-incomplete" = nextClockIn
      ? "newer-incomplete"
      : clockInAgeMinutes >= STALE_OPEN_SESSION_MINUTES
        ? "stale-incomplete"
        : "active";

    return {
      entry,
      employee,
      impact,
      nextClockIn,
      clockIn,
    };
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

  const [selectedWorkday, setSelectedWorkday] = useState<EmployeeWorkday | null>(null);
  const {
    employeeEntriesById,
    rawEmployeeEntriesById,
    visibleEmployees,
    workdays,
    monthWorkdays,
    viewingWorkday,
    weekWorkdayGroups,
    monthWorkdayGroups,
    hasVisibleWorkdays,
    totalHours,
    totalPay,
  } = useTimesheetViewModel({
    entries,
    employees,
    viewMode,
    weekDays,
    selectedDay,
    selectedMonth,
    monthEnd,
    selectedRole,
    employeeSearch,
    paidBreakMinutes,
    selectedWorkday,
    viewingDate,
  });

  const setViewingWorkdayManual = (wd: EmployeeWorkday, date: Date) => {
    setSelectedWorkday(wd);
    setViewingDate(date);
  };

  const activeDay = viewingDate || selectedDay;

  const isInitialTimesheetLoading = empsLoading || entriesLoading;
  const isTimesheetUpdating = !isInitialTimesheetLoading && (empsFetching || entriesFetching);

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

  const handleSaveNote = () => {
    if (!noteEditor) return;
    updateEntryMutation.mutate(
      { id: noteEditor.entry.id, notes: noteEditor.value.trim() },
      {
        onSuccess: () => {
          toast({ title: "Note saved", description: "Timesheet note updated." });
          setNoteEditor(null);
        },
      },
    );
  };

  const handleDeleteNote = (entry: TimeEntry) => {
    updateEntryMutation.mutate(
      { id: entry.id, notes: null },
      {
        onSuccess: () => toast({ title: "Note deleted", description: "Timesheet note removed." }),
      },
    );
  };

  const handleSaveEdit = () => {
    if (!editingEntry || !editTime || !/^\d{2}:\d{2}$/.test(editTime)) return;
    const entryDate = editingEntry.date;
    // Overnight-aware: for non-clock-in entries, if the resulting time-of-day is earlier
    // than the workday's clock-in, the entry actually belongs to the next calendar day.
    // Without this, editing a clock-out or break on an overnight shift produces a
    // timestamp BEFORE the clock-in, which splits the workday into two cards.
    const naive = new Date(`${entryDate}T${editTime}:00`);
    const isClockInEdit = editingEntry.type === "clock-in";
    const newTimestamp = (!isClockInEdit && viewingWorkday?.clockIn && naive.getTime() < viewingWorkday.clockIn.getTime())
      ? new Date(naive.getTime() + 24 * 60 * 60 * 1000)
      : naive;

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
      updateEntryMutation.mutate({ id: editingEntry.id, timestamp: newTimestamp.toISOString() }, {
        onSuccess: () => {
          toast({ title: "Success", description: "Time updated successfully" });
          setEditingEntry(null);
        }
      });
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

    const doSave = (finalClockOutTs: string | null) => {
      const finalize = () => {
        setEditingShift(null);
        setShiftWarning(null);
        toast({ title: "Shift updated", description: "Shift times have been saved." });
      };

      if (clockInEntry && finalClockOutTs) {
        updateEntryMutation.mutate(
          { id: clockInEntry.id, timestamp: new Date(`${dateStr}T${editShiftClockIn}:00`).toISOString() },
          {
            onSuccess: () => {
              if (clockOutEntry) {
                updateEntryMutation.mutate({ id: clockOutEntry.id, timestamp: finalClockOutTs }, { onSuccess: finalize });
              } else {
                addEntryMutation.mutate(
                  { employeeId: editingShift!.employee.id, type: "clock-out", date: dateStr, timestamp: finalClockOutTs },
                  { onSuccess: finalize }
                );
              }
            }
          }
        );
      } else if (clockInEntry) {
        updateEntryMutation.mutate(
          { id: clockInEntry.id, timestamp: new Date(`${dateStr}T${editShiftClockIn}:00`).toISOString() },
          { onSuccess: finalize }
        );
      } else {
        finalize();
      }
    };

    const originalClockInTs = editingShift.clockIn!.getTime();
    const newClockInTs = new Date(`${dateStr}T${editShiftClockIn}:00`).getTime();
    const clockOutTs = clockOutTimestamp ? new Date(clockOutTimestamp).getTime() : Infinity;

    const empEntries = employeeEntriesById.get(editingShift.employee.id) || [];
    const allSessions = processEntriesForEmployee(editingShift.employee, empEntries, paidBreakMinutes);
    const relevantSessions = getRelevantSessions(allSessions, dateStr);
    const origEnd = editingShift.clockOut?.getTime() ?? null;
    const conflictSession = relevantSessions.find(session => {
      if (!session.clockIn || session.clockIn.getTime() === originalClockInTs) return false;
      const sStart = session.clockIn.getTime();
      if (origEnd && sStart >= originalClockInTs && sStart <= origEnd) return false;
      const sEnd = session.clockOut ? session.clockOut.getTime() : Date.now();
      return newClockInTs < sEnd && clockOutTs > sStart;
    });

    if (conflictSession) {
      const mergedEnd = conflictSession.clockOut && clockOutTimestamp
        ? new Date(Math.max(conflictSession.clockOut.getTime(), new Date(clockOutTimestamp).getTime()))
        : (conflictSession.clockOut || (clockOutTimestamp ? new Date(clockOutTimestamp) : null));
      if (mergedEnd) {
        setMergeDialog({
          conflictSession,
          mergedClockOutTs: mergedEnd.toISOString(),
        });
        return;
      }
      const conflictLabel = conflictSession.clockOut
        ? `${format(conflictSession.clockIn!, "HH:mm")} â€“ ${format(conflictSession.clockOut, "HH:mm")}`
        : `${format(conflictSession.clockIn!, "HH:mm")} (still open)`;
      toast({
        title: "Conflicting Timesheet",
        description: `Cannot save because the edited times would overlap with an existing shift from ${conflictLabel}. Please adjust the times or delete the conflicting shift first.`,
        variant: "destructive",
      });
      return;
    }

    if (!clockOutTimestamp) {
      doSave(null);
      return;
    }

    const durationHours = (clockOutTs - newClockInTs) / (1000 * 60 * 60);

    if (durationHours > 15) {
      setShiftWarning({
        title: "Very Long Shift",
        description: `This shift would be ${durationHours.toFixed(1)} hours. Are you sure this is correct?`,
        actions: [
          { label: "Yes, Confirm", onClick: () => doSave(clockOutTimestamp) },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    doSave(clockOutTimestamp);
  };

  const handleConfirmMerge = () => {
    if (!mergeDialog || !editingShift) return;
    const conflictClockOutEntry = mergeDialog.conflictSession.entries.find(e => e.type === "clock-out");
    const finalizeMerge = () => {
      const idsToDelete = editingShift.entries.map(e => e.id);
      deleteEntriesBatchMutation.mutate(idsToDelete, {
        onSuccess: () => {
          invalidateVisibleEntries();
          setMergeDialog(null);
          setEditingShift(null);
          toast({ title: "Shifts combined", description: "The overlapping shifts have been merged into one." });
        },
      });
    };
    if (conflictClockOutEntry) {
      updateEntryMutation.mutate(
        { id: conflictClockOutEntry.id, timestamp: mergeDialog.mergedClockOutTs },
        { onSuccess: finalizeMerge }
      );
    } else {
      const conflictClockInEntry = mergeDialog.conflictSession.entries.find(e => e.type === "clock-in");
      if (conflictClockInEntry) {
        addEntryMutation.mutate(
          { employeeId: editingShift.employee.id, type: "clock-out", date: conflictClockInEntry.date as string, timestamp: mergeDialog.mergedClockOutTs },
          { onSuccess: finalizeMerge }
        );
      }
    }
  };

  const handleSaveBreakEdit = () => {
    if (!editingBreak) return;

    const toBreakEditTs = (timeStr: string, originalEntry: TimeEntry): Date => {
      const originalTs = new Date(originalEntry.timestamp);
      const originalDateStr = format(originalTs, "yyyy-MM-dd");
      const entryDateStr = toEntryDateString(originalEntry.date);
      const anchorDates = Array.from(new Set([
        originalDateStr,
        entryDateStr,
        viewingWorkday?.clockIn ? format(viewingWorkday.clockIn, "yyyy-MM-dd") : null,
        viewingWorkday?.clockOut ? format(viewingWorkday.clockOut, "yyyy-MM-dd") : null,
      ].filter(Boolean) as string[]));

      const candidates = anchorDates.flatMap((dateStr) => {
        const base = new Date(`${dateStr}T${timeStr}:00`);
        return [-1, 0, 1].map(days => new Date(base.getTime() + days * 24 * 60 * 60 * 1000));
      });

      const minMs = viewingWorkday?.clockIn ? viewingWorkday.clockIn.getTime() + 60 * 1000 : -Infinity;
      const maxMs = viewingWorkday?.clockOut ? viewingWorkday.clockOut.getTime() - 60 * 1000 : Infinity;
      const inShift = candidates.filter(candidate => candidate.getTime() >= minMs && candidate.getTime() <= maxMs);
      const pool = inShift.length > 0 ? inShift : candidates;

      return pool.reduce((best, candidate) => (
        Math.abs(candidate.getTime() - originalTs.getTime()) < Math.abs(best.getTime() - originalTs.getTime())
          ? candidate
          : best
      ));
    };

    const hasStart = !!(editingBreak.start && /^\d{2}:\d{2}$/.test(editBreakStart));
    const hasEnd = !!(editingBreak.end && /^\d{2}:\d{2}$/.test(editBreakEnd));

    const newStartTs = hasStart
      ? toBreakEditTs(editBreakStart, editingBreak.start!)
      : (editingBreak.start ? new Date(editingBreak.start.timestamp) : null);
    const newEndTs = hasEnd
      ? toBreakEditTs(editBreakEnd, editingBreak.end!)
      : (editingBreak.end ? new Date(editingBreak.end.timestamp) : null);

    // Validation: Break end must be after break start
    if (newStartTs && newEndTs && newEndTs.getTime() <= newStartTs.getTime()) {
      toast({ title: "Invalid Time", description: "Break end must be after break start.", variant: "destructive" });
      return;
    }

    // Validation: Break must be within clock-in / clock-out with 1-minute buffer (Date math, not HH:mm)
    if (viewingWorkday) {
      if (viewingWorkday.clockIn && newStartTs && newStartTs.getTime() <= viewingWorkday.clockIn.getTime()) {
        toast({ title: "Invalid Time", description: "Break must start at least 1 minute after clock-in.", variant: "destructive" });
        return;
      }
      if (viewingWorkday.clockOut && newEndTs && newEndTs.getTime() >= viewingWorkday.clockOut.getTime()) {
        toast({ title: "Invalid Time", description: "Break must end at least 1 minute before clock-out.", variant: "destructive" });
        return;
      }
      if (viewingWorkday.clockOut && newStartTs && newStartTs.getTime() >= viewingWorkday.clockOut.getTime()) {
        toast({ title: "Invalid Time", description: "Break start cannot be at or after clock-out.", variant: "destructive" });
        return;
      }
    }

    // Validation: Must not overlap with other existing breaks (Date math, not HH:mm)
    if (viewingWorkday && newStartTs && newEndTs) {
      const otherBreaks = getBreakPairs(viewingWorkday.entries, viewingWorkday.clockIn, viewingWorkday.clockOut)
        .filter(p => p.start.id !== editingBreak.start?.id);
      for (const other of otherBreaks) {
        const otherStartMs = new Date(other.start.timestamp).getTime();
        const otherEndMs = other.end ? new Date(other.end.timestamp).getTime() : null;
        if (otherEndMs !== null && newStartTs.getTime() <= otherEndMs && newEndTs.getTime() >= otherStartMs) {
          toast({ title: "Invalid Time", description: "This break overlaps with another break in the same shift.", variant: "destructive" });
          return;
        }
      }
    }

    const closeAndToast = () => {
      setEditingBreak(null);
      toast({ title: "Success", description: "Break time updated" });
    };

    if (hasStart && hasEnd) {
      updateEntryMutation.mutate(
        { id: editingBreak.start!.id, timestamp: newStartTs!.toISOString() },
        {
          onSuccess: () => {
            updateEntryMutation.mutate(
              { id: editingBreak.end!.id, timestamp: newEndTs!.toISOString() },
              { onSuccess: closeAndToast }
            );
          }
        }
      );
    } else if (hasStart) {
      updateEntryMutation.mutate(
        { id: editingBreak.start!.id, timestamp: newStartTs!.toISOString() },
        { onSuccess: closeAndToast }
      );
    } else if (hasEnd) {
      updateEntryMutation.mutate(
        { id: editingBreak.end!.id, timestamp: newEndTs!.toISOString() },
        { onSuccess: closeAndToast }
      );
    }
  };

  const [addingNewBreak, setAddingNewBreak] = useState<EmployeeWorkday | null>(null);
  const [newBreakStartTime, setNewBreakStartTime] = useState<string>("");
  const [newBreakEndTime, setNewBreakEndTime] = useState<string>("");

  const handleAddNewBreak = async () => {
    if (!addingNewBreak || !newBreakStartTime || !newBreakEndTime) return;
    if (!/^\d{2}:\d{2}$/.test(newBreakStartTime) || !/^\d{2}:\d{2}$/.test(newBreakEndTime)) return;

    // Validate break is within clock-in / clock-out with 1-minute buffer.
    // Use full Date math (not HH:mm string compare) so overnight shifts work
    // (e.g. break 23:00 -> 01:00 on a shift that crosses midnight).
    const dateStr = addingNewBreak.entries.find(e => e.type === "clock-in")?.date || format(activeDay, "yyyy-MM-dd");
    const toBreakTs = (timeStr: string): Date => {
      const naive = new Date(`${dateStr}T${timeStr}:00`);
      // Overnight shift: if the entered time-of-day is earlier than the clock-in, it belongs to the next calendar day.
      if (addingNewBreak.clockIn && naive.getTime() < addingNewBreak.clockIn.getTime()) {
        return new Date(naive.getTime() + 24 * 60 * 60 * 1000);
      }
      return naive;
    };
    const breakStartTs = toBreakTs(newBreakStartTime);
    const breakEndTs = toBreakTs(newBreakEndTime);

    if (breakEndTs.getTime() <= breakStartTs.getTime()) {
      toast({ title: "Invalid Time", description: "Break end must be after break start.", variant: "destructive" });
      return;
    }
    if (addingNewBreak.clockIn && breakStartTs.getTime() <= addingNewBreak.clockIn.getTime()) {
      toast({ title: "Invalid Time", description: "Break must start at least 1 minute after clock-in.", variant: "destructive" });
      return;
    }
    if (addingNewBreak.clockOut && breakEndTs.getTime() >= addingNewBreak.clockOut.getTime()) {
      toast({ title: "Invalid Time", description: "Break must end at least 1 minute before clock-out.", variant: "destructive" });
      return;
    }
    if (addingNewBreak.clockOut && breakStartTs.getTime() >= addingNewBreak.clockOut.getTime()) {
      toast({ title: "Invalid Time", description: "Break cannot start at or after clock-out.", variant: "destructive" });
      return;
    }

    const existingBreaks = getBreakPairs(addingNewBreak.entries, addingNewBreak.clockIn, addingNewBreak.clockOut);
    for (const other of existingBreaks) {
      const otherStartTs = new Date(other.start.timestamp).getTime();
      const otherEndTs = other.end ? new Date(other.end.timestamp).getTime() : null;
      if (otherEndTs !== null && breakStartTs.getTime() <= otherEndTs && breakEndTs.getTime() >= otherStartTs) {
        setAddingNewBreak(null);
        setNewBreakStartTime("");
        setNewBreakEndTime("");
        setTimeout(() => setBreakOverlapWarning({ conflicting: other }), 200);
        return;
      }
    }

    const empId = addingNewBreak.employee.id;
    const startTs = breakStartTs.toISOString();
    const endTs = breakEndTs.toISOString();
    setAddingNewBreak(null);
    setNewBreakStartTime("");
    setNewBreakEndTime("");
    try {
      await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-start", date: dateStr, timestamp: startTs });
      await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-end", date: dateStr, timestamp: endTs });
      toast({ title: "Break added", description: "The break has been recorded." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
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

    const empEntries = employeeEntriesById.get(emp.id) || [];
    const allSessions = processEntriesForEmployee(emp, empEntries, paidBreakMinutes);
    const relevantSessions = getRelevantSessions(allSessions, dateStr);
    const conflictSession = relevantSessions.find(session => {
      if (!session.clockIn || session.clockIn.getTime() === clockInTs) return false;
      const sStart = session.clockIn.getTime();
      const sEnd = session.clockOut ? session.clockOut.getTime() : Infinity;
      return clockInTs < sEnd && clockOutTs > sStart;
    });

    if (conflictSession) {
      const conflictLabel = conflictSession.clockOut
        ? `${format(conflictSession.clockIn!, "HH:mm")} â€“ ${format(conflictSession.clockOut, "HH:mm")}`
        : `${format(conflictSession.clockIn!, "HH:mm")} (still open)`;
      toast({
        title: "Conflicting Timesheet",
        description: `Cannot set this clock-out time because it would overlap with an existing shift from ${conflictLabel}. Please choose a different time or delete the conflicting shift first.`,
        variant: "destructive",
      });
      return;
    }

    const doAdd = (finalTs: string) => {
      addEntryMutation.mutate({ employeeId: emp.id, type: "clock-out", date: dateStr, timestamp: finalTs });
      setShiftWarning(null);
    };

    if (durationHours > 15) {
      setShiftWarning({
        title: "Very Long Shift",
        description: `This shift would be ${durationHours.toFixed(1)} hours. Are you sure?`,
        actions: [
          { label: "Yes, Confirm", onClick: () => doAdd(clockOutTimestamp) },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    doAdd(clockOutTimestamp);
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

    const doAdd = async (finalClockOutTs: string | null) => {
      await addEntryMutation.mutateAsync({ employeeId: empId, type: "clock-in", date: dateStr, timestamp: clockInTimestamp, role: roleToSave });
      if (newTimesheetBreakStart && newTimesheetBreakEnd && /^\d{2}:\d{2}$/.test(newTimesheetBreakStart) && /^\d{2}:\d{2}$/.test(newTimesheetBreakEnd)) {
        await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-start", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetBreakStart}:00`).toISOString() });
        await addEntryMutation.mutateAsync({ employeeId: empId, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${newTimesheetBreakEnd}:00`).toISOString() });
      }
      if (finalClockOutTs) {
        await addEntryMutation.mutateAsync({ employeeId: empId, type: "clock-out", date: dateStr, timestamp: finalClockOutTs });
      }
      toast({ title: "Success", description: "Timesheet added" });
      setAddingTimesheet(false);
      setShiftWarning(null);
      resetAddTimesheetForm();
    };

    if (!clockOutTimestamp) {
      const clockInTs = new Date(clockInTimestamp).getTime();
      const empEntries = employeeEntriesById.get(empId) || [];
      const allSessions = processEntriesForEmployee(emp, empEntries, paidBreakMinutes);
      const relevantSessions = getRelevantSessions(allSessions, dateStr);

      const insideExistingShift = relevantSessions.find(session => {
        if (!session.clockIn) return false;
        const sStart = session.clockIn.getTime();
        const sEnd = session.clockOut ? session.clockOut.getTime() : Infinity;
        return clockInTs >= sStart && clockInTs < sEnd;
      });
      if (insideExistingShift) {
        const conflictLabel = insideExistingShift.clockOut
          ? `${format(insideExistingShift.clockIn!, "HH:mm")} â€“ ${format(insideExistingShift.clockOut, "HH:mm")}`
          : `${format(insideExistingShift.clockIn!, "HH:mm")} (still open)`;
        toast({
          title: "Conflicting Timesheet",
          description: `Cannot add this shift because the clock-in time falls inside an existing shift from ${conflictLabel}. Please adjust the time or delete the conflicting shift first.`,
          variant: "destructive",
        });
        return;
      }

      const openSession = relevantSessions.find(session =>
        session.clockIn &&
        (session.status === "working" || session.status === "on-break") &&
        session.clockIn.getTime() < clockInTs &&
        format(session.clockIn, "yyyy-MM-dd") === dateStr
      );
      const hasNewerSession = !openSession && relevantSessions.some(session =>
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
                await doAdd(null);
              },
            },
            { label: "Add Anyway", variant: "outline", onClick: async () => { setShiftWarning(null); await doAdd(null); } },
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
            { label: "Leave as Incomplete", onClick: async () => { await doAdd(null); } },
            { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
          ],
        });
        return;
      }

      await doAdd(null);
      return;
    }

    const clockInTs = new Date(clockInTimestamp).getTime();
    const clockOutTs = new Date(clockOutTimestamp).getTime();
    const durationHours = (clockOutTs - clockInTs) / (1000 * 60 * 60);

    const empEntries = employeeEntriesById.get(empId) || [];
    const allSessions = processEntriesForEmployee(emp, empEntries, paidBreakMinutes);
    const relevantSessions = getRelevantSessions(allSessions, dateStr);
    const conflictSession = relevantSessions.find(session => {
      if (!session.clockIn) return false;
      const sStart = session.clockIn.getTime();
      const sEnd = session.clockOut ? session.clockOut.getTime() : Infinity;
      return clockInTs < sEnd && clockOutTs > sStart;
    });

    if (conflictSession) {
      const conflictLabel = conflictSession.clockOut
        ? `${format(conflictSession.clockIn!, "HH:mm")} â€“ ${format(conflictSession.clockOut, "HH:mm")}`
        : `${format(conflictSession.clockIn!, "HH:mm")} (still open)`;
      toast({
        title: "Conflicting Timesheet",
        description: `Cannot add this shift because it overlaps with an existing shift from ${conflictLabel}. Please adjust the times or delete the conflicting shift first.`,
        variant: "destructive",
      });
      return;
    }

    if (durationHours > 15) {
      setShiftWarning({
        title: "Very Long Shift",
        description: `This shift would be ${durationHours.toFixed(1)} hours. Are you sure this is correct?`,
        actions: [
          { label: "Yes, Confirm", onClick: async () => { await doAdd(clockOutTimestamp); } },
          { label: "Cancel", variant: "outline", onClick: () => setShiftWarning(null) },
        ],
      });
      return;
    }

    await doAdd(clockOutTimestamp);
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
      const startStr = format(start, "yyyy-MM-dd");
      const endStr = format(end, "yyyy-MM-dd");
      const queryStartStr = format(addDays(start, -1), "yyyy-MM-dd");
      const queryEndStr = format(addDays(end, 1), "yyyy-MM-dd");
      const rangeLabel = `Period: ${format(start, "MMM d, yyyy")} â€“ ${format(end, "MMM d, yyyy")}`;

      const entriesRes = await apiRequest("GET", `/api/steepin/entries?from=${queryStartStr}&to=${queryEndStr}`);
      const exportEntries = normalizeEntryDates(await entriesRes.json());

      let shiftsData: Shift[] | undefined;
      if (exportShowScheduled) {
        const res = await apiRequest("GET", `/api/shifts?from=${startStr}&to=${endStr}`);
        shiftsData = await res.json();
      }

      await exportTimesheetPDF(start, end, rangeLabel, exportEntries, visibleEmployees, exportSelectedEmployeeIds, paidBreakMinutes, {
        showScheduledComparison: exportShowScheduled,
        shifts: shiftsData,
      });
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
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            <div className="flex items-center gap-2">
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

      <div className="p-4 space-y-4 flex-1 overflow-y-scroll custom-scrollbar scrollbar-gutter-stable">
        {isTimesheetUpdating && (
          <div className="text-[11px] text-muted-foreground">
            Updating timesheets...
          </div>
        )}
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
                  {[...visibleEmployees]
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
          {isInitialTimesheetLoading ? (
            <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
              Loading timesheets...
            </div>
          ) : viewMode === "week" ? (
            workdays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 italic text-sm">
                <Calendar className="w-8 h-8 mb-2 opacity-20" />
                <p>No entries for this day</p>
              </div>
            ) : (
              weekWorkdayGroups.map(({ employeeId, sessions }) => (
                <WorkdayCard
                  key={employeeId}
                  sessions={sessions}
                  date={selectedDay}
                  statusConfig={statusConfig}
                  approvalRequests={approvalRequests}
                  onViewWorkday={setViewingWorkdayManual}
                />
              ))
            )
          ) : (
            monthWorkdays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 italic text-sm">
                <Calendar className="w-8 h-8 mb-2 opacity-20" />
                <p>No entries for this month</p>
              </div>
            ) : (
              monthWorkdayGroups.map(({ date, groups, totalMinutes }) => (
                <div key={date.toISOString()} className="space-y-2">
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {format(date, "EEEE, MMM d")}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">
                      {formatHoursDecimal(totalMinutes)} h total
                    </span>
                  </div>
                  {groups.map(({ employeeId, sessions }) => (
                    <WorkdayCard
                      key={employeeId}
                      sessions={sessions}
                      date={date}
                      statusConfig={statusConfig}
                      approvalRequests={approvalRequests}
                      onViewWorkday={setViewingWorkdayManual}
                    />
                  ))}
                </div>
              ))
            )
          )}
        </div>
      </div>

      {!isInitialTimesheetLoading && hasVisibleWorkdays && (
        <div className="border-t bg-background sticky bottom-0 z-10 px-4 py-3 flex items-center justify-end gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-lg font-bold" data-testid="text-total-hours">{formatHoursDecimal(totalHours)} h</span>
          {totalPay !== null && totalPay > 0 && (
            <Badge variant="secondary" className="text-sm font-bold px-2 py-0.5" data-testid="text-total-pay">
              {formatCurrency(totalPay)}
            </Badge>
          )}
        </div>
      )}

      {/* Export PDF Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Export Timesheet PDF
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium tracking-wide">Experimental</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-[11px] text-primary hover:bg-transparent hover:underline"
                  onClick={() => setExportSelectedEmployeeIds(
                    exportSelectedEmployeeIds.length === visibleEmployees.length
                      ? []
                      : visibleEmployees.map(e => e.id)
                  )}
                  data-testid="button-export-select-all"
                >
                  {exportSelectedEmployeeIds.length === visibleEmployees.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
              <div className="max-h-44 overflow-auto border rounded-md p-2 space-y-0.5">
                {[...visibleEmployees]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(emp => (
                    <div 
                      key={emp.id} 
                      className="flex items-center gap-2 p-1.5 rounded-sm hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => toggleExportEmployee(emp.id)}
                      data-testid={`export-emp-${emp.id}`}
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
              {exportSelectedEmployeeIds.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No employees selected â€” select at least one.</p>
              )}
              {exportSelectedEmployeeIds.length > 1 && (
                <p className="text-[11px] text-muted-foreground">Each employee will get their own page, followed by a summary.</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between mb-0.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Optional Columns</Label>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">off by default</Badge>
              </div>
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium leading-none">Scheduled shift comparison</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Shows time arrived late and total hours over / under the scheduled shift, for days with a scheduled shift set.</p>
                  </div>
                  <Switch
                    checked={exportShowScheduled}
                    onCheckedChange={setExportShowScheduled}
                    data-testid="toggle-export-scheduled"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button 
              onClick={handleExportPDF} 
              disabled={isExporting || exportSelectedEmployeeIds.length === 0}
              className="w-full sm:w-auto px-8 gap-2"
              data-testid="button-export-pdf-download"
            >
              <FileDown className="w-4 h-4" />
              {isExporting ? "Generatingâ€¦" : "Download PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!viewingWorkday} onOpenChange={(open) => { 
        if (!open) {
          setSelectedWorkday(null); 
          setViewingDate(null); 
          setNoteEditor(null);
          setConfirmDelete(false);
          setDeletingClockOut(null);
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
                            setSelectedWorkday(null);
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
                      <div className="font-medium text-muted-foreground">â€” (no clock-out)</div>
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
                                ? `No break Â· ${formatHoursDecimal(netWorkedMinutes)}h worked`
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
                          {clockOutEntry && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDeletingClockOut(getClockOutDeletePreview(clockOutEntry, emp, clockIn))}
                              disabled={deleteEntryMutation.isPending}
                              data-testid="button-delete-clock-out"
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> Delete Clock Out
                            </Button>
                          )}
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
                          <div className="font-medium font-mono">{clockIn ? format(clockIn, "HH:mm") : "â€”"}</div>
                        </div>
                        <div className="text-muted-foreground mt-3">â†’</div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-0.5">Clock Out</div>
                          <div className="font-medium font-mono">{clockOut ? format(clockOut, "HH:mm") : "â€”"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {(() => {
                  const dateStr = dayEntries.find(e => e.type === "clock-in")?.date as string || format(activeDay, "yyyy-MM-dd");
                  const breakPairs = getBreakPairs(dayEntries, clockIn, clockOut);
                  if (breakPairs.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      {breakPairs.map((bp, idx) => (
                        <div key={bp.start.id} className="rounded-md border p-3 text-sm">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Break {breakPairs.length > 1 ? idx + 1 : ""}</span>
                              {!bp.end ? (
                                <span className="text-[10px] bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium" data-testid={`status-unfinished-break-${idx}`}>Unfinished</span>
                              ) : (
                                <button
                                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium border transition-colors ${bp.start.isUnpaid ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800" : "bg-muted text-muted-foreground border-border hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 hover:border-red-200"}`}
                                  title={bp.start.isUnpaid ? "Marked as unpaid â€” click to toggle" : "Mark as unpaid break"}
                                  onClick={() => updateEntryMutation.mutate({ id: bp.start.id, isUnpaid: !bp.start.isUnpaid })}
                                  data-testid={`button-toggle-unpaid-${idx}`}
                                >
                                  {bp.start.isUnpaid ? "Unpaid" : "Paid"}
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {bp.end && (
                                <Button variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={() => {
                                    if (!bp.end) return;
                                    const breakEnd = bp.end;
                                    setEditingBreak({ start: bp.start, end: breakEnd });
                                    setEditBreakStart(format(new Date(bp.start.timestamp), "HH:mm"));
                                    setEditBreakEnd(format(new Date(breakEnd.timestamp), "HH:mm"));
                                  }}
                                  data-testid={`button-edit-break-${idx}`}
                                >
                                  <Edit2 className="w-3 h-3" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                                onClick={() => setDeletingBreak(bp)}
                                data-testid={`button-delete-break-${idx}`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                              {!bp.end && (
                                <Button variant="outline" size="sm" className="h-6 text-xs px-2"
                                  onClick={() => {
                                    const breakStartStr = format(new Date(bp.start.timestamp), "HH:mm");
                                    openClock(format(new Date(), "HH:mm"), (v) => {
                                      if (v <= breakStartStr) {
                                        toast({ title: "Invalid Time", description: "Break end must be after break start.", variant: "destructive" });
                                        return;
                                      }
                                      const clockOutStr = clockOut ? format(clockOut, "HH:mm") : null;
                                      if (clockOutStr && v >= clockOutStr) {
                                        toast({ title: "Invalid Time", description: "Break must end at least 1 minute before clock-out.", variant: "destructive" });
                                        return;
                                      }
                                      const otherBreaks = getBreakPairs(dayEntries, clockIn, clockOut)
                                        .filter(p => p.start.id !== bp.start.id && p.end);
                                      for (const other of otherBreaks) {
                                        const otherStart = format(new Date(other.start.timestamp), "HH:mm");
                                        const otherEnd = format(new Date(other.end!.timestamp), "HH:mm");
                                        if (breakStartStr <= otherEnd && v >= otherStart) {
                                          toast({ title: "Invalid Time", description: "This break would overlap with another break in the same shift.", variant: "destructive" });
                                          return;
                                        }
                                      }
                                      addEntryMutation.mutate({ employeeId: emp.id, type: "break-end", date: dateStr, timestamp: new Date(`${dateStr}T${v}:00`).toISOString() });
                                    });
                                  }}
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
                            <div className="text-muted-foreground mt-3">â†’</div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-0.5">End</div>
                              <div className="font-medium font-mono">{bp.end ? format(new Date(bp.end.timestamp), "HH:mm") : "â€”"}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {clockOut && (() => {
                  // Only show for the last completed session AND only if the employee has no open session
                  const allEmpEntries = rawEmployeeEntriesById.get(emp.id) || [];
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
                          // Always read the freshest entries at click time â€” avoids stale closure issues
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
                              clockOutDate: toEntryDateString(freshClockOut.date),
                            });
                          } else {
                            reopenShiftMutation.mutate({
                              clockOutEntryId: freshClockOut.id,
                              employeeId: emp.id,
                              clockOutDate: toEntryDateString(freshClockOut.date),
                              clockOutTimestamp: toEntryTimestampIso(freshClockOut.timestamp),
                              gapOption: "none",
                            });
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

                {(() => {
                  const noteEntries = dayEntries.filter(e => e.notes);
                  const addNoteTarget =
                    dayEntries.find(e => e.type === "clock-in" && !e.notes) ||
                    dayEntries.find(e => !e.notes);
                  const typeLabel = (entryType: string) =>
                    entryType === "clock-in" ? "Clock In"
                      : entryType === "clock-out" ? "Clock Out"
                        : entryType === "break-start" ? "Break Start"
                          : entryType === "break-end" ? "Break End"
                            : entryType;
                  return (
                    <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <StickyNote className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Notes</span>
                        </div>
                        {addNoteTarget && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                            onClick={() => setNoteEditor({ entry: addNoteTarget, value: "" })}
                            disabled={updateEntryMutation.isPending}
                            data-testid="button-add-timesheet-note"
                          >
                            <Plus className="w-3 h-3 mr-1" /> {noteEntries.length > 0 ? "Add" : "Add Note"}
                          </Button>
                        )}
                      </div>
                      {noteEditor && dayEntries.some(e => e.id === noteEditor.entry.id) && (
                        <div className="mb-3 space-y-2 rounded border border-blue-200/70 dark:border-blue-800/70 bg-background/70 p-2">
                          <Textarea
                            value={noteEditor.value}
                            onChange={(e) => setNoteEditor({ ...noteEditor, value: e.target.value })}
                            placeholder="Write a short note for this timesheet..."
                            className="min-h-[90px] resize-none text-sm"
                            data-testid="textarea-timesheet-note"
                          />
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setNoteEditor(null)} disabled={updateEntryMutation.isPending}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={handleSaveNote} disabled={updateEntryMutation.isPending || !noteEditor.value.trim()} data-testid="button-save-timesheet-note">
                              {updateEntryMutation.isPending ? "Saving..." : "Save Note"}
                            </Button>
                          </div>
                        </div>
                      )}
                      {noteEntries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No notes yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {noteEntries.map(e => (
                            <div key={e.id} className="rounded border border-blue-200/70 dark:border-blue-800/70 bg-background/60 p-2 text-xs" data-testid={`note-entry-${e.id}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <span className="font-medium text-blue-600 dark:text-blue-400">{typeLabel(e.type)}</span>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{e.notes}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => setNoteEditor({ entry: e, value: e.notes || "" })}
                                    disabled={updateEntryMutation.isPending}
                                    data-testid={`button-edit-note-${e.id}`}
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-destructive"
                                    onClick={() => handleDeleteNote(e)}
                                    disabled={updateEntryMutation.isPending}
                                    data-testid={`button-delete-note-${e.id}`}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

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
                    setNewBreakStartTime("");
                    setNewBreakEndTime("");
                    setAddingNewBreak(viewingWorkday);
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
                            const date = (dayEntries.length > 0 ? dayEntries[0].date as string : null) || format(activeDay, "yyyy-MM-dd");
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

      {/* Edit Shift dialog â€” pencil edits both Clock In and Clock Out */}
      <Dialog open={!!editingShift} onOpenChange={() => setEditingShift(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Shift Time</DialogTitle></DialogHeader>
          {editingShift && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground">{editingShift.employee.name} â€” {(() => { const d = editingShift.entries.find(e => e.type === "clock-in")?.date; return d ? format(new Date(d + "T00:00:00"), "EEE, MMM d, yyyy") : format(activeDay, "EEE, MMM d, yyyy"); })()}</div>
              <div className="space-y-2">
                <Label>Clock In / Clock Out</Label>
                <TimeRangeInput startValue={editShiftClockIn} endValue={editShiftClockOut} onStartChange={setEditShiftClockIn} onEndChange={setEditShiftClockOut} startTestId="input-edit-shift-clock-in" endTestId="input-edit-shift-clock-out" />
                {/^\d{2}:\d{2}$/.test(editShiftClockOut) && editShiftClockOut < editShiftClockIn && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Overnight shift â€” clock out will be saved as the next day.</p>
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

      {/* Edit Break dialog â€” pencil edits both Break Start and Break End */}
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

      {/* Add Break Dialog */}
      <Dialog open={!!addingNewBreak} onOpenChange={(open) => { if (!open) { setAddingNewBreak(null); setNewBreakStartTime(""); setNewBreakEndTime(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Break</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Break Start / Break End</Label>
              <TimeRangeInput startValue={newBreakStartTime} endValue={newBreakEndTime} onStartChange={setNewBreakStartTime} onEndChange={setNewBreakEndTime} startTestId="input-new-break-start" endTestId="input-new-break-end" />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleAddNewBreak}
              disabled={addEntryMutation.isPending || !newBreakStartTime || !newBreakEndTime}
              className="w-full sm:w-auto px-8"
              data-testid="button-save-new-break"
            >
              {addEntryMutation.isPending ? "Saving..." : "Add Break"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Break Overlap Warning Dialog */}
      <Dialog open={!!breakOverlapWarning} onOpenChange={(open) => { if (!open) setBreakOverlapWarning(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Break Conflict</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            The time you entered conflicts with an existing break{" "}
            {breakOverlapWarning && (
              <span className="font-medium text-foreground">
                {format(new Date(breakOverlapWarning.conflicting.start.timestamp), "HH:mm")}
                {breakOverlapWarning.conflicting.end
                  ? ` â€“ ${format(new Date(breakOverlapWarning.conflicting.end.timestamp), "HH:mm")}`
                  : ""}
              </span>
            )}
            . Would you like to edit that break instead?
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => setBreakOverlapWarning(null)}
              data-testid="button-overlap-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!breakOverlapWarning) return;
                const bp = breakOverlapWarning.conflicting;
                setBreakOverlapWarning(null);
                setEditingBreak({ start: bp.start, end: bp.end });
                setEditBreakStart(format(new Date(bp.start.timestamp), "HH:mm"));
                setEditBreakEnd(bp.end ? format(new Date(bp.end.timestamp), "HH:mm") : "");
              }}
              data-testid="button-overlap-edit-existing"
            >
              Edit Existing Break
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Clock Out Confirmation Dialog */}
      <Dialog open={!!deletingClockOut} onOpenChange={(open) => { if (!open) setDeletingClockOut(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Clock Out</DialogTitle>
          </DialogHeader>
          {deletingClockOut && (
            <div className="space-y-3 py-1">
              <p className="text-sm text-muted-foreground">
                This will delete only the clock-out at{" "}
                <span className="font-medium text-foreground">
                  {format(new Date(deletingClockOut.entry.timestamp), "HH:mm")}
                </span>
                .
              </p>
              {deletingClockOut.impact === "active" ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  This is the newest shift for {deletingClockOut.employee.name}, and the clock-in is still inside the active-session window. Deleting the clock-out will reopen the timesheet as active.
                </div>
              ) : deletingClockOut.impact === "stale-incomplete" ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  This is the newest shift for {deletingClockOut.employee.name}, but its clock-in is already more than 24 hours old. Deleting the clock-out will remove the close time, but the timesheet will be shown as incomplete instead of active.
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  There is a newer timesheet starting at{" "}
                  <span className="font-semibold">
                    {deletingClockOut.nextClockIn ? format(new Date(deletingClockOut.nextClockIn.timestamp), "EEE, MMM d HH:mm") : "a later time"}
                  </span>
                  , so this older timesheet will become incomplete instead of reopening.
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Other clock-ins, breaks, notes, and newer timesheets will stay unchanged.
              </p>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setDeletingClockOut(null)} data-testid="button-cancel-delete-clock-out">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteEntryMutation.isPending}
              onClick={() => {
                if (!deletingClockOut) return;
                const impact = deletingClockOut.impact;
                deleteEntryMutation.mutate(deletingClockOut.entry.id, {
                  onSuccess: () => {
                    setDeletingClockOut(null);
                    toast({
                      title: "Clock-out deleted",
                      description: impact === "active"
                        ? "The timesheet has been reopened as active."
                        : impact === "stale-incomplete"
                          ? "The timesheet is now open-ended and marked incomplete."
                        : "The older timesheet is now marked incomplete.",
                    });
                  },
                });
              }}
              data-testid="button-confirm-delete-clock-out"
            >
              {deleteEntryMutation.isPending ? "Deleting..." : "Delete Clock Out"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Break Confirmation Dialog */}
      <Dialog open={!!deletingBreak} onOpenChange={(open) => { if (!open) setDeletingBreak(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Break</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            Are you sure you want to delete this break?{" "}
            {deletingBreak && (
              <span className="font-medium text-foreground">
                {format(new Date(deletingBreak.start.timestamp), "HH:mm")}
                {deletingBreak.end ? ` â€“ ${format(new Date(deletingBreak.end.timestamp), "HH:mm")}` : ""}
              </span>
            )}
            {" "}This cannot be undone.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setDeletingBreak(null)} data-testid="button-cancel-delete-break">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteEntryMutation.isPending}
              onClick={() => {
                if (!deletingBreak) return;
                const startId = deletingBreak.start.id;
                const endId = deletingBreak.end?.id;
                const finish = () => {
                  setDeletingBreak(null);
                  toast({ title: "Break deleted" });
                };
                if (endId) {
                  deleteEntryMutation.mutate(startId, {
                    onSuccess: () => deleteEntryMutation.mutate(endId, { onSuccess: finish })
                  });
                } else {
                  deleteEntryMutation.mutate(startId, { onSuccess: finish });
                }
              }}
              data-testid="button-confirm-delete-break"
            >
              {deleteEntryMutation.isPending ? "Deleting..." : "Delete"}
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

      {/* Merge Shifts Dialog */}
      <Dialog open={!!mergeDialog} onOpenChange={(open) => { if (!open) setMergeDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Combine Shifts?</DialogTitle>
          </DialogHeader>
          {mergeDialog && (
            <div className="space-y-3 py-1">
              <p className="text-sm text-muted-foreground">
                The edited time overlaps with an existing shift from{" "}
                <span className="font-medium text-foreground">
                  {format(mergeDialog.conflictSession.clockIn!, "HH:mm")}
                  {mergeDialog.conflictSession.clockOut ? ` â€“ ${format(mergeDialog.conflictSession.clockOut, "HH:mm")}` : " (open)"}
                </span>
                .
              </p>
              <p className="text-sm text-muted-foreground">
                Would you like to combine them into one shift ending at{" "}
                <span className="font-medium text-foreground">
                  {format(new Date(mergeDialog.mergedClockOutTs), "HH:mm")}
                </span>
                ?
              </p>
              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={handleConfirmMerge}>Combine Shifts</Button>
                <Button variant="outline" onClick={() => setMergeDialog(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Direct Clock Picker â€” only for single-action adds (Add Clock Out, Add End Break, Add Break) */}
      <ClockPickerDialog
        open={clockPicker.open}
        onOpenChange={(open) => setClockPicker(p => ({ ...p, open }))}
        value={clockPicker.value}
        onChange={(v) => { setClockPicker(p => ({ ...p, open: false })); clockPicker.onConfirm(v); }}
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
          {visibleEmployees.length === 0 ? (
            <div className="py-6 flex flex-col items-center text-center">
              <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {employees.length === 0 ? "No employees found" : "No active employees available"}
              </h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-[300px]">
                {employees.length === 0
                  ? "You need to add at least one employee before you can create a timesheet."
                  : "Unarchive an employee before creating a new timesheet for them."}
              </p>
              <Button 
                onClick={() => {
                  setAddingTimesheet(false);
                  setLocation("/employees");
                }}
              >
                {employees.length === 0 ? "Go to Employees" : "Manage Employees"}
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
                      const emp = visibleEmployees.find(e => String(e.id) === val);
                      if (emp?.role) setNewTimesheetRole(emp.role);
                    }}
                  >
                    <SelectTrigger data-testid="select-timesheet-employee">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...visibleEmployees].sort((a, b) => a.name.localeCompare(b.name)).map(emp => (
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
                    ? <p className="text-xs text-amber-600 dark:text-amber-400">Overnight shift â€” clock out will be saved as the next day.</p>
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

      {/* Reopen Shift â€” Gap Time Dialog */}
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
                  The shift closed at <span className="font-medium text-foreground">{clockOutTime}</span> and it is now <span className="font-medium text-foreground">{nowTime}</span> â€” a gap of <span className="font-medium text-foreground">{gapLabel}</span>.
                  How should this time be counted?
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-3 px-4"
                    disabled={reopenShiftMutation.isPending}
                    onClick={() => reopenShiftMutation.mutate({ clockOutEntryId: clockOutEntry.id, employeeId, clockOutDate, clockOutTimestamp: toEntryTimestampIso(clockOutEntry.timestamp), gapOption: "break" })}
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
                    onClick={() => reopenShiftMutation.mutate({ clockOutEntryId: clockOutEntry.id, employeeId, clockOutDate, clockOutTimestamp: toEntryTimestampIso(clockOutEntry.timestamp), gapOption: "unpaid-break" })}
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
                    onClick={() => reopenShiftMutation.mutate({ clockOutEntryId: clockOutEntry.id, employeeId, clockOutDate, clockOutTimestamp: toEntryTimestampIso(clockOutEntry.timestamp), gapOption: "worked" })}
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
