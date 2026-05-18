import { differenceInMinutes, format, parseISO } from "date-fns";
import {
  OFFLINE_ACTION_MAX_DRIFT_MS,
  isOpenSessionEntryType,
  timeStringToMinutes,
} from "@shared/timekeeping";
import { broadcastEntryUpdate } from "../../sse";
import { pool, storage } from "../../storage";
import { autoCloseStaleSession } from "../../routes/auto-close";
import { toDateOnly } from "../../routes/utils";
import { roundClockActionIfEnabled } from "./clock-rounding";

type KioskActionBody = {
  employeeId?: unknown;
  type?: string;
  passcode?: string;
  notes?: string;
  offlineTimestamp?: string;
};

type KioskActionResult = {
  status: number;
  body: unknown;
};

const result = (status: number, body: unknown): KioskActionResult => ({ status, body });

export async function handleKioskAction(body: KioskActionBody): Promise<KioskActionResult> {
  const { employeeId, type, passcode, notes, offlineTimestamp } = body;
  if (!employeeId || !type || !passcode) {
    return result(400, { message: "Employee ID, action type, and passcode are required" });
  }

  const employeeIdNum = Number(employeeId);
  const emp = await storage.getEmployee(employeeIdNum);
  if (!emp) return result(404, { message: "Employee not found" });
  if (emp.status !== "active" || emp.hiddenFromSteepin) {
    return result(403, { message: "Employee is archived" });
  }

  if (emp.accessCode !== passcode) {
    return result(401, { message: "Invalid passcode" });
  }

  const actionTime = offlineTimestamp ? new Date(offlineTimestamp) : new Date();

  await autoCloseStaleSession(employeeIdNum);
  if (offlineTimestamp && Math.abs(actionTime.getTime() - Date.now()) > OFFLINE_ACTION_MAX_DRIFT_MS) {
    return result(400, { message: "Offline timestamp too far from current time" });
  }

  let date = format(actionTime, "yyyy-MM-dd");
  if (type !== "clock-in") {
    const openDate = await storage.getOpenSessionDate(employeeIdNum);
    if (openDate) {
      date = openDate;
    } else {
      return result(409, { message: `Cannot ${type}: no active shift found` });
    }

    const sessionStartRow = await pool.query(
      `SELECT timestamp FROM time_entries
       WHERE employee_id = $1 AND entry_date = $2 AND type = 'clock-in'
       ORDER BY timestamp DESC LIMIT 1`,
      [employeeIdNum, openDate],
    );
    const sessionStartTs = sessionStartRow.rows[0]?.timestamp;
    const sessionEntries = sessionStartTs
      ? await pool.query(
          `SELECT type FROM time_entries
           WHERE employee_id = $1 AND timestamp >= $2
           ORDER BY timestamp ASC`,
          [employeeIdNum, sessionStartTs],
        )
      : { rows: [] as any[] };
    const types = sessionEntries.rows.map((row: any) => row.type);
    const lastType = types.length > 0 ? types[types.length - 1] : null;

    if (type === "clock-out" && (lastType === "clock-out" || !types.includes("clock-in"))) {
      return result(409, { message: "Cannot clock out: employee is not clocked in" });
    }
    if (type === "break-start" && lastType !== "clock-in" && lastType !== "break-end") {
      return result(409, { message: "Cannot start break: employee is not in an active shift or already on break" });
    }
    if (type === "break-end" && lastType !== "break-start") {
      return result(409, { message: "Cannot end break: employee is not on break" });
    }
  }

  if (type === "clock-in") {
    const existingOpenDate = await storage.getOpenSessionDate(employeeIdNum);
    if (existingOpenDate) {
      const todayStr = format(actionTime, "yyyy-MM-dd");
      let shouldAutoClose = false;
      let autoCloseTime: Date;
      let autoCloseDate: string;

      if (existingOpenDate !== todayStr) {
        shouldAutoClose = true;
        autoCloseDate = existingOpenDate;
        const prevDay = parseISO(existingOpenDate);
        autoCloseTime = new Date(prevDay);
        autoCloseTime.setHours(23, 59, 59, 0);
      } else {
        const shiftsToday = await storage.getShiftsByEmployeeAndDate(employeeIdNum, todayStr);
        const nowMinutes = actionTime.getHours() * 60 + actionTime.getMinutes();
        const immediateShift = shiftsToday.find((shift) => {
          const diff = timeStringToMinutes(shift.startTime) - nowMinutes;
          return diff >= -5 && diff <= 15;
        });
        if (immediateShift) {
          const iStart = timeStringToMinutes(immediateShift.startTime);
          const iEnd = timeStringToMinutes(immediateShift.endTime);
          const iEndAdj = iEnd <= iStart ? iEnd + 1440 : iEnd;
          const isProximityPair = shiftsToday.some((other) => {
            if (other.id === immediateShift.id) return false;
            const oStart = timeStringToMinutes(other.startTime);
            const oEnd = timeStringToMinutes(other.endTime);
            const oEndAdj = oEnd <= oStart ? oEnd + 1440 : oEnd;
            const gapAfter = iStart - oEndAdj;
            const gapBefore = oStart - iEndAdj;
            return (gapAfter >= 0 && gapAfter < 20) || (gapBefore >= 0 && gapBefore < 20);
          });
          if (!isProximityPair) {
            shouldAutoClose = true;
            autoCloseDate = todayStr;
            autoCloseTime = actionTime;
          }
        }
      }

      if (shouldAutoClose) {
        await storage.createTimeEntryManual(
          employeeIdNum,
          "clock-out",
          autoCloseDate!,
          autoCloseTime!,
          null,
          "auto-closed",
          false,
          "auto-close",
        );
        broadcastEntryUpdate(employeeIdNum, {
          type: "clock-out",
          timestamp: autoCloseTime!.toISOString(),
          source: "auto-close",
          accountId: emp.ownerAccountId ?? undefined,
          date: autoCloseDate!,
        });
      }
    }
  }

  if (type === "clock-in") {
    const lastClockOut = await storage.getLastClockOutForEmployee(employeeIdNum);
    if (lastClockOut) {
      const lastClockOutDate = toDateOnly(lastClockOut.date as string | Date);
      const minutesSince = differenceInMinutes(actionTime, new Date(lastClockOut.timestamp));
      if (minutesSince < 2) {
        await storage.deleteTimeEntry(lastClockOut.id);
        broadcastEntryUpdate(employeeIdNum, {
          type: "delete",
          timestamp: actionTime.toISOString(),
          source: "auto-reclock",
          accountId: emp.ownerAccountId ?? undefined,
          date: lastClockOutDate,
        });
        return result(201, { reClockHandled: true, action: "reopen", entryId: lastClockOut.id });
      } else if (minutesSince <= 10) {
        await storage.deleteTimeEntry(lastClockOut.id);
        await storage.createTimeEntryManual(
          employeeIdNum,
          "break-start",
          lastClockOutDate,
          new Date(lastClockOut.timestamp),
          null,
          null,
          true,
          "auto-reclock",
        );
        const entry = await storage.createTimeEntryManual(
          employeeIdNum,
          "break-end",
          lastClockOutDate,
          actionTime,
          null,
          null,
          true,
          "auto-reclock",
        );
        broadcastEntryUpdate(employeeIdNum, {
          type: "break-end",
          timestamp: actionTime.toISOString(),
          source: "auto-reclock",
          accountId: emp.ownerAccountId ?? undefined,
          date: lastClockOutDate,
        });
        return result(201, {
          reClockHandled: true,
          action: "unpaid-break",
          gapMinutes: minutesSince,
          entryId: entry.id,
        });
      }
    }
  }

  const account = emp.ownerAccountId ? await storage.getAccount(emp.ownerAccountId) : undefined;
  const rounding = await roundClockActionIfEnabled({
    account,
    employee: emp,
    type,
    actionTime,
    entryDate: date,
  });
  if (rounding) {
    date = rounding.date;
  }
  const entryActionTime = rounding?.timestamp ?? actionTime;
  const entry = (offlineTimestamp || rounding)
    ? await storage.createTimeEntryManual(employeeIdNum, type, date, entryActionTime, null, notes || null, false, "employee")
    : await storage.createTimeEntry(employeeIdNum, type, date, notes || null);

  if (notes && notes.trim() && emp.ownerAccountId) {
    const settings = await storage.getNotificationSettings(emp.ownerAccountId);
    if (settings.notifyNotes) {
      const actionLabel = type === "clock-in" ? "clocked in" : type === "clock-out" ? "clocked out" : type === "break-start" ? "started break" : "ended break";
      await storage.createNotification({
        accountId: emp.ownerAccountId,
        type: "employee-note",
        title: "Employee Note",
        message: `${emp.name} ${actionLabel} with note: "${notes.trim()}"`,
        data: JSON.stringify({ employeeId: emp.id, entryId: entry.id, entryDate: date }),
      });
    }
  }

  if (emp.ownerAccountId) {
    const settings = await storage.getNotificationSettings(emp.ownerAccountId);
    const tz = settings.timezone || "UTC";

    const localMinutesInTz = (d: Date): { minutes: number; dateStr: string } => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(d);
      const map: Record<string, string> = {};
      for (const part of parts) map[part.type] = part.value;
      const hh = parseInt(map.hour || "0", 10);
      const mm = parseInt(map.minute || "0", 10);
      return {
        minutes: hh * 60 + mm,
        dateStr: `${map.year}-${map.month}-${map.day}`,
      };
    };

    const recentEntriesInWindow = async (entryType: string): Promise<Date[]> => {
      const since = new Date(entryActionTime.getTime() - 36 * 60 * 60 * 1000);
      const rows = await pool.query(
        `SELECT timestamp FROM time_entries
         WHERE employee_id = $1 AND type = $2 AND id <> $3 AND timestamp >= $4`,
        [employeeIdNum, entryType, entry.id, since.toISOString()],
      );
      return rows.rows.map((row: any) => new Date(row.timestamp));
    };

    const minutesFromShiftStart = (eventTime: Date, shift: { startTime: string; endTime: string }): number | null => {
      const shiftStart = timeStringToMinutes(shift.startTime);
      const shiftEnd = timeStringToMinutes(shift.endTime);
      const shiftEndAdj = shiftEnd <= shiftStart ? shiftEnd + 1440 : shiftEnd;
      const eventLocal = localMinutesInTz(eventTime).minutes;
      const candidates = [eventLocal, eventLocal + 1440, eventLocal - 1440];
      let best: number | null = null;
      for (const candidate of candidates) {
        if (candidate < shiftStart - 60 || candidate > shiftEndAdj + 120) continue;
        const delta = candidate - shiftStart;
        if (best === null || Math.abs(delta) < Math.abs(best - shiftStart)) {
          best = candidate;
        }
      }
      return best === null ? null : best - shiftStart;
    };

    if (type === "clock-in" && settings.notifyLate) {
      const localNow = localMinutesInTz(entryActionTime);
      const yesterday = new Date(entryActionTime.getTime() - 24 * 60 * 60 * 1000);
      const yLocal = localMinutesInTz(yesterday);
      const shiftsTodayResult = await storage.getShiftsByEmployeeAndDate(employeeIdNum, localNow.dateStr);
      const shiftsYesterdayResult = await storage.getShiftsByEmployeeAndDate(employeeIdNum, yLocal.dateStr);
      const candidateShifts = [...shiftsTodayResult, ...shiftsYesterdayResult];
      if (candidateShifts.length > 0) {
        const priorClockInTimes = await recentEntriesInWindow("clock-in");

        for (const shift of candidateShifts) {
          const shiftStart = timeStringToMinutes(shift.startTime);
          const shiftEnd = timeStringToMinutes(shift.endTime);
          const shiftDurMinutes = (shiftEnd <= shiftStart ? shiftEnd + 1440 : shiftEnd) - shiftStart;

          const offsetFromStart = minutesFromShiftStart(entryActionTime, shift);
          if (offsetFromStart === null) continue;

          const alreadyWorked = priorClockInTimes.some((clockInTime) => {
            const off = minutesFromShiftStart(clockInTime, shift);
            return off !== null && off >= -30 && off <= shiftDurMinutes;
          });
          if (alreadyWorked) continue;

          if (offsetFromStart > settings.lateThresholdMinutes) {
            await storage.createNotification({
              accountId: emp.ownerAccountId,
              type: "employee-late",
              title: "Late Clock-In",
              message: `${emp.name} clocked in ${offsetFromStart} minutes after their scheduled shift start (${shift.startTime.slice(0, 5)}).`,
              data: JSON.stringify({ employeeId: emp.id, shiftId: shift.id }),
            });
            break;
          }
        }
      }
    }

    if (type === "clock-out" && settings.notifyEarlyClockOut) {
      const localNow = localMinutesInTz(entryActionTime);
      const yesterday = new Date(entryActionTime.getTime() - 24 * 60 * 60 * 1000);
      const yLocal = localMinutesInTz(yesterday);
      const sessShifts = await storage.getShiftsByEmployeeAndDate(employeeIdNum, date);
      const sessShiftsAlt = date !== localNow.dateStr ? await storage.getShiftsByEmployeeAndDate(employeeIdNum, localNow.dateStr) : [];
      const sessShiftsYest = await storage.getShiftsByEmployeeAndDate(employeeIdNum, yLocal.dateStr);
      const candidateShifts = [...sessShifts, ...sessShiftsAlt, ...sessShiftsYest];
      if (candidateShifts.length > 0) {
        const priorClockOutTimes = await recentEntriesInWindow("clock-out");

        for (const shift of candidateShifts) {
          const shiftStart = timeStringToMinutes(shift.startTime);
          const shiftEnd = timeStringToMinutes(shift.endTime);
          const shiftEndAdj = shiftEnd <= shiftStart ? shiftEnd + 1440 : shiftEnd;
          const shiftDurMinutes = shiftEndAdj - shiftStart;

          const offsetFromStart = minutesFromShiftStart(entryActionTime, shift);
          if (offsetFromStart === null) continue;

          const alreadyClosed = priorClockOutTimes.some((clockOutTime) => {
            const off = minutesFromShiftStart(clockOutTime, shift);
            return off !== null && off >= 0 && off <= shiftDurMinutes + 60;
          });
          if (alreadyClosed) continue;

          const earlyByMinutes = shiftDurMinutes - offsetFromStart;
          if (earlyByMinutes > settings.earlyClockOutThresholdMinutes) {
            await storage.createNotification({
              accountId: emp.ownerAccountId,
              type: "early-clock-out",
              title: "Early Clock-Out",
              message: `${emp.name} clocked out ${earlyByMinutes} minutes before their scheduled shift end (${shift.endTime.slice(0, 5)}).`,
              data: JSON.stringify({ employeeId: emp.id, shiftId: shift.id }),
            });
            break;
          }
        }
      }
    }
  }

  broadcastEntryUpdate(employeeIdNum, {
    type: entry.type,
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
    source: "employee",
    accountId: emp.ownerAccountId ?? undefined,
    date,
  });

  let updatedEntries = await storage.getTimeEntriesByEmployeeAndDate(employeeIdNum, date);
  const lastTypeAfter = updatedEntries.length > 0 ? updatedEntries[updatedEntries.length - 1].type : null;
  if (!isOpenSessionEntryType(lastTypeAfter)) {
    const openDateAfter = await storage.getOpenSessionDate(employeeIdNum);
    if (openDateAfter && openDateAfter !== date) {
      updatedEntries = await storage.getTimeEntriesByEmployeeAndDate(employeeIdNum, openDateAfter);
    }
  }

  return result(201, { ...entry, entries: updatedEntries, ...(rounding ? { rounding } : {}) });
}
