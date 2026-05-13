import { addDays, format, parseISO } from "date-fns";
import { storage } from "../../storage";
import {
  assertCanAddCustomRoles,
  getRinseTimesheetHistoryCutoff,
  isRinseAccountId,
  pruneRinseBackupsAfterImport,
  RINSE_IMPORT_BACKUP_LABEL,
  RinseFeatureLimitError,
} from "../subscription-limits";

type CsvImportBody = {
  rows?: unknown;
  timezoneOffset?: number;
  skipBackup?: boolean;
};

type CsvImportRow = {
  employeeName?: unknown;
  date?: string;
  clockIn?: string;
  clockOut?: string;
  breaks?: Array<{ start?: string; end?: string; isUnpaid?: boolean }>;
  role?: string;
  notes?: string;
};

type ImportableCsvImportRow = CsvImportRow & {
  employeeName: unknown;
  date: string;
  clockIn: string;
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function getImportableRows(rows: unknown[]): ImportableCsvImportRow[] {
  return rows.filter((rawRow): rawRow is ImportableCsvImportRow => {
    const row = rawRow as CsvImportRow;
    return !!row.employeeName && typeof row.date === "string" && DATE_ONLY_RE.test(row.date) && !!row.clockIn;
  });
}

function getIncomingRoleNames(rows: CsvImportRow[]) {
  return [
    ...new Set(
      rows
        .map((row) => typeof row.role === "string" ? row.role.trim() : "")
        .filter(Boolean),
    ),
  ];
}

export async function importTimesheetCsv(ownerAccountId: number, body: CsvImportBody) {
  const { rows, timezoneOffset = 0, skipBackup = false } = body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 400, body: { message: "No rows provided" } };
  }
  const importableRows = getImportableRows(rows);
  const rinseCutoff = await getRinseTimesheetHistoryCutoff(ownerAccountId);
  if (rinseCutoff) {
    const blockedRow = importableRows.find((row) => row.date < rinseCutoff);
    if (blockedRow) {
      return {
        status: 403,
        body: {
          code: "RINSE_TIMESHEET_HISTORY_LIMIT",
          message: `Rinse timesheet history is limited to the last 180 days. The row for ${blockedRow.employeeName} on ${blockedRow.date} is outside that range.`,
        },
      };
    }
  }

  try {
    await assertCanAddCustomRoles(ownerAccountId, getIncomingRoleNames(importableRows));
  } catch (err) {
    if (err instanceof RinseFeatureLimitError) {
      return { status: err.status, body: { code: err.code, message: err.message } };
    }
    throw err;
  }

  const tzOffsetMs = timezoneOffset * 60000;

  const makeTimestamp = (dateStr: string, timeStr: string): Date => {
    const ts = new Date(`${dateStr}T${timeStr}:00Z`);
    ts.setTime(ts.getTime() + tzOffsetMs);
    return ts;
  };

  const resolveCalendarDate = (time: string, clockIn: string, shiftDate: string, isCrossMidnight: boolean): string => {
    if (!isCrossMidnight) return shiftDate;
    return time < clockIn ? format(addDays(parseISO(shiftDate), 1), "yyyy-MM-dd") : shiftDate;
  };

  if (!skipBackup) {
    try {
      const backup = await storage.createTimesheetBackup(ownerAccountId, RINSE_IMPORT_BACKUP_LABEL);
      await pruneRinseBackupsAfterImport(ownerAccountId, backup.id);
    } catch (_) {
      if (await isRinseAccountId(ownerAccountId)) {
        return {
          status: 500,
          body: { message: "Could not create the required automatic import backup. No rows were imported." },
        };
      }
    }
  }

  const existingEmployees = await storage.getEmployees(ownerAccountId);
  const empByName = new Map<string, number>();
  existingEmployees.forEach(e => empByName.set(e.name.toLowerCase(), e.id));

  const existingRoles = await storage.getCustomRoles(ownerAccountId);
  const roleByName = new Map<string, boolean>();
  existingRoles.forEach(r => roleByName.set(r.name.toLowerCase(), true));

  const newEmployeeNames: string[] = [];
  const newRoleNames: string[] = [];
  let created = 0;
  let replaced = 0;

  const getOrCreateEmployee = async (name: string): Promise<number> => {
    const key = name.toLowerCase();
    if (empByName.has(key)) return empByName.get(key)!;
    const emp = await storage.createEmployee({
      name,
      email: "",
      phone: "",
      role: "",
      department: "",
      color: "#3B82F6",
      status: "active",
      ownerAccountId,
    });
    empByName.set(key, emp.id);
    newEmployeeNames.push(emp.name);
    return emp.id;
  };

  const ensureRole = async (roleName: string) => {
    if (!roleName?.trim()) return;
    const key = roleName.trim().toLowerCase();
    if (roleByName.has(key)) return;
    try {
      await storage.createCustomRole(ownerAccountId, roleName.trim());
      roleByName.set(key, true);
      newRoleNames.push(roleName.trim());
    } catch (_) {}
  };

  const deletedDates = new Set<string>();
  const toInsert: Array<{
    employeeId: number;
    type: string;
    date: string;
    timestamp: Date;
    role?: string | null;
    notes?: string | null;
    isUnpaid?: boolean;
  }> = [];

  for (const rawRow of rows as CsvImportRow[]) {
    const { employeeName, date, clockIn, clockOut, breaks, role, notes } = rawRow;
    if (!employeeName || !date || !clockIn) continue;

    const employeeId = await getOrCreateEmployee(String(employeeName).trim());
    const isCrossMidnight = clockOut ? clockOut < clockIn : false;
    const clockInTs = makeTimestamp(date, clockIn);

    if (role) await ensureRole(role);

    const dateKey = `${employeeId}:${date}`;
    if (!deletedDates.has(dateKey)) {
      const existing = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      if (existing.length > 0) {
        await storage.deleteTimeEntriesByEmployeeAndDate(employeeId, date);
        replaced += existing.length;
      }
      deletedDates.add(dateKey);
    }

    toInsert.push({ employeeId, type: "clock-in", date, timestamp: clockInTs, role: role || null, notes: notes || null });

    if (Array.isArray(breaks)) {
      for (const brk of breaks) {
        if (!brk.start || !brk.end) continue;
        const bStartCalendar = resolveCalendarDate(brk.start, clockIn, date, isCrossMidnight);
        const bEndCalendar = brk.end < brk.start
          ? format(addDays(parseISO(bStartCalendar), 1), "yyyy-MM-dd")
          : bStartCalendar;
        toInsert.push({ employeeId, type: "break-start", date, timestamp: makeTimestamp(bStartCalendar, brk.start), isUnpaid: brk.isUnpaid === true });
        toInsert.push({ employeeId, type: "break-end", date, timestamp: makeTimestamp(bEndCalendar, brk.end) });
      }
    }

    if (clockOut) {
      const clockOutCalendar = resolveCalendarDate(clockOut, clockIn, date, isCrossMidnight);
      toInsert.push({ employeeId, type: "clock-out", date, timestamp: makeTimestamp(clockOutCalendar, clockOut), role: role || null });
    }

    created++;
  }

  await storage.batchCreateTimeEntries(toInsert);

  return {
    status: 200,
    body: { created, replaced, newEmployees: newEmployeeNames, newRoles: newRoleNames },
  };
}
