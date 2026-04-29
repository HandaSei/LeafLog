import type { Router } from "express";
import { addDays, differenceInMinutes, format, parseISO } from "date-fns";
import type { TimeEntry } from "@shared/schema";
import { requireAuth, requireRole } from "../auth";
import { pool, storage } from "../storage";
import { addSSEClient, broadcastEntryUpdate, removeSSEClient } from "../sse";
import { autoCloseStaleSession } from "./auto-close";
import { DATE_ONLY_RE, getDateRangeQuery } from "./utils";

export function registerTimeTrackingRoutes(router: Router) {
  router.get("/api/steepin/employees", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const emps = await storage.getEmployees(ownerAccountId);
    res.json(emps.filter(e => e.status === "active" && !e.hiddenFromSteepin));
  });

  router.get("/api/steepin/entries/:employeeId", async (req, res) => {
    await autoCloseStaleSession(Number(req.params.employeeId));
    const todayStr = format(new Date(), "yyyy-MM-dd");
    let entries = await storage.getTimeEntriesByEmployeeAndDate(Number(req.params.employeeId), todayStr);
    const lastType = entries.length > 0 ? entries[entries.length - 1].type : null;
    const hasOpenSession = lastType === "clock-in" || lastType === "break-start" || lastType === "break-end";
    if (!hasOpenSession) {
      const openDate = await storage.getOpenSessionDate(Number(req.params.employeeId));
      if (openDate && openDate !== todayStr) {
        entries = await storage.getTimeEntriesByEmployeeAndDate(Number(req.params.employeeId), openDate);
      }
    }
    res.json(entries);
  });

  // Legacy check endpoint — replaced by SSE stream. Returns static response
  // to prevent old clients from hammering the database.
  router.get("/api/steepin/entries/:employeeId/check", (_req, res) => {
    res.json({ deprecated: true, useStream: true });
  });

  router.get("/api/steepin/entries/:employeeId/stream", (req, res) => {
    const employeeId = Number(req.params.employeeId);
    if (isNaN(employeeId)) {
      return res.status(400).json({ message: "Invalid employee ID" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ employeeId })}\n\n`);

    const client = addSSEClient(employeeId, res);

    req.on("close", () => {
      removeSSEClient(client);
    });
  });

  router.get("/api/steepin/open-sessions", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const entries = await storage.getOpenSessionEntries(ownerAccountId);
    res.json(entries);
  });

  router.get("/api/steepin/entries", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const range = getDateRangeQuery(req);
    if (range && "error" in range) return res.status(400).json({ message: range.error });
    if (range) {
      const entries = await storage.getTimeEntriesByDateRange(ownerAccountId, range.from, range.to, employeeId);
      return res.json(entries);
    }
    if (employeeId && date) {
      const entries = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      return res.json(entries);
    } else if (date) {
      const entries = await storage.getTimeEntriesByDate(date, ownerAccountId);
      return res.json(entries);
    }

    const entries = await storage.getAllTimeEntries(ownerAccountId);
    res.json(entries);
  });

  router.post("/api/steepin/action", async (req, res) => {
    const { employeeId, type, passcode, notes, reClockAction, skipReClockCheck, offlineTimestamp } = req.body;
    if (!employeeId || !type || !passcode) {
      return res.status(400).json({ message: "Employee ID, action type, and passcode are required" });
    }

    const emp = await storage.getEmployee(Number(employeeId));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    if (emp.status !== "active" || emp.hiddenFromSteepin) {
      return res.status(403).json({ message: "Employee is archived" });
    }

    if (emp.accessCode !== passcode) {
      return res.status(401).json({ message: "Invalid passcode" });
    }

    const actionTime = offlineTimestamp ? new Date(offlineTimestamp) : new Date();

    // Auto-close stale open sessions before processing any action
    await autoCloseStaleSession(Number(employeeId));
    const maxDriftMs = 24 * 60 * 60 * 1000;
    if (offlineTimestamp && Math.abs(actionTime.getTime() - Date.now()) > maxDriftMs) {
      return res.status(400).json({ message: "Offline timestamp too far from current time" });
    }

    let date = format(actionTime, "yyyy-MM-dd");
    if (type !== "clock-in") {
      const openDate = await storage.getOpenSessionDate(Number(employeeId));
      if (openDate) {
        date = openDate;
      } else {
        return res.status(409).json({ message: `Cannot ${type}: no active shift found` });
      }

      // Fetch all entries for the open session by timestamp window (handles cross-midnight sessions
      // where break-end / clock-out land on a later calendar date than the original clock-in).
      const sessionStartRow = await pool.query(
        `SELECT timestamp FROM time_entries
         WHERE employee_id = $1 AND entry_date = $2 AND type = 'clock-in'
         ORDER BY timestamp DESC LIMIT 1`,
        [Number(employeeId), openDate]
      );
      const sessionStartTs = sessionStartRow.rows[0]?.timestamp;
      const sessionEntries = sessionStartTs
        ? await pool.query(
            `SELECT type FROM time_entries
             WHERE employee_id = $1 AND timestamp >= $2
             ORDER BY timestamp ASC`,
            [Number(employeeId), sessionStartTs]
          )
        : { rows: [] as any[] };
      const types = sessionEntries.rows.map((r: any) => r.type);
      const lastType = types.length > 0 ? types[types.length - 1] : null;

      if (type === "clock-out" && (lastType === "clock-out" || !types.includes("clock-in"))) {
        return res.status(409).json({ message: "Cannot clock out: employee is not clocked in" });
      }
      if (type === "break-start" && lastType !== "clock-in" && lastType !== "break-end") {
        return res.status(409).json({ message: "Cannot start break: employee is not in an active shift or already on break" });
      }
      if (type === "break-end" && lastType !== "break-start") {
        return res.status(409).json({ message: "Cannot end break: employee is not on break" });
      }
    }

    if (type === "clock-in") {
      const existingOpenDate = await storage.getOpenSessionDate(Number(employeeId));
      if (existingOpenDate) {
        const todayStr = format(actionTime, "yyyy-MM-dd");
        let shouldAutoClose = false;
        let autoCloseTime: Date;
        let autoCloseDate: string;

        if (existingOpenDate !== todayStr) {
          // Open session is from a previous day — auto-close it at 23:59:59 of that day
          shouldAutoClose = true;
          autoCloseDate = existingOpenDate;
          const prevDay = parseISO(existingOpenDate);
          autoCloseTime = new Date(prevDay);
          autoCloseTime.setHours(23, 59, 59, 0);
        } else {
          // Open session is from today — auto-close if a scheduled shift starts within 15 minutes,
          // but NOT if that shift is part of a proximity pair (< 20 min from another shift)
          const shiftsToday = await storage.getShiftsByEmployeeAndDate(Number(employeeId), todayStr);
          const nowMinutes = actionTime.getHours() * 60 + actionTime.getMinutes();
          const tmins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
          const immediateShift = shiftsToday.find((s) => {
            const diff = tmins(s.startTime) - nowMinutes;
            return diff >= -5 && diff <= 15;
          });
          if (immediateShift) {
            // Check if the upcoming shift is within 20 min of another shift (proximity pair)
            const iStart = tmins(immediateShift.startTime);
            const iEnd = tmins(immediateShift.endTime);
            const iEndAdj = iEnd <= iStart ? iEnd + 1440 : iEnd;
            const isProximityPair = shiftsToday.some((other) => {
              if (other.id === immediateShift.id) return false;
              const oStart = tmins(other.startTime);
              const oEnd = tmins(other.endTime);
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
            Number(employeeId),
            "clock-out",
            autoCloseDate!,
            autoCloseTime!,
            null,
            "auto-closed",
            false,
            "auto-close"
          );
          broadcastEntryUpdate(Number(employeeId), { type: "clock-out", timestamp: autoCloseTime!.toISOString(), source: "auto-close" });
        }
      }
    }

    if (type === "clock-in") {
      const lastClockOut = await storage.getLastClockOutForEmployee(Number(employeeId));
      if (lastClockOut) {
        const minutesSince = differenceInMinutes(actionTime, new Date(lastClockOut.timestamp));
        if (minutesSince < 2) {
          await storage.deleteTimeEntry(lastClockOut.id);
          broadcastEntryUpdate(Number(employeeId), { type: "delete", timestamp: actionTime.toISOString(), source: "auto-reclock" });
          return res.status(201).json({ reClockHandled: true, action: "reopen", entryId: lastClockOut.id });
        } else if (minutesSince <= 10) {
          // Treat the gap as an unpaid break
          await storage.deleteTimeEntry(lastClockOut.id);
          await storage.createTimeEntryManual(
            Number(employeeId),
            "break-start",
            lastClockOut.date as string,
            new Date(lastClockOut.timestamp),
            null,
            null,
            true,
            "auto-reclock"
          );
          const entry = await storage.createTimeEntryManual(
            Number(employeeId),
            "break-end",
            lastClockOut.date as string,
            actionTime,
            null,
            null,
            true,
            "auto-reclock"
          );
          broadcastEntryUpdate(Number(employeeId), { type: "break-end", timestamp: actionTime.toISOString(), source: "auto-reclock" });
          return res.status(201).json({ reClockHandled: true, action: "unpaid-break", gapMinutes: minutesSince, entryId: entry.id });
        }
      }
    }

    const entry = offlineTimestamp
      ? await storage.createTimeEntryManual(Number(employeeId), type, date, actionTime, null, notes || null, false, "employee")
      : await storage.createTimeEntry(Number(employeeId), type, date, notes || null);

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

      // Compute "now" in the agency's local wall-clock minutes from a UTC timestamp.
      const localMinutesInTz = (d: Date): { minutes: number; dateStr: string } => {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: tz,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(d);
        const map: Record<string, string> = {};
        for (const p of parts) map[p.type] = p.value;
        const hh = parseInt(map.hour || "0", 10);
        const mm = parseInt(map.minute || "0", 10);
        return {
          minutes: hh * 60 + mm,
          dateStr: `${map.year}-${map.month}-${map.day}`,
        };
      };
      const tmins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

      // Helper: pull recent entries for this employee within a window of "now" so we can dedup
      // alerts using actual timestamps (not entry_date, which is timezone-fragile).
      const recentEntriesInWindow = async (entryType: string): Promise<Date[]> => {
        const since = new Date(actionTime.getTime() - 36 * 60 * 60 * 1000); // 36h back covers any overnight shift
        const r = await pool.query(
          `SELECT timestamp FROM time_entries
           WHERE employee_id = $1 AND type = $2 AND id <> $3 AND timestamp >= $4`,
          [Number(employeeId), entryType, entry.id, since.toISOString()]
        );
        return r.rows.map((row: any) => new Date(row.timestamp));
      };

      // For an event time, return wall-clock minutes-since-shift-start, accounting for overnight shifts.
      // Returns null if the event isn't reasonably attributable to that shift.
      const minutesFromShiftStart = (eventTime: Date, shift: { startTime: string; endTime: string }): number | null => {
        const shiftStart = tmins(shift.startTime);
        const shiftEnd = tmins(shift.endTime);
        const shiftEndAdj = shiftEnd <= shiftStart ? shiftEnd + 1440 : shiftEnd;
        const eventLocal = localMinutesInTz(eventTime).minutes;
        // Try same-day mapping and next-day mapping; pick whichever lands closest to the shift window.
        const candidates = [eventLocal, eventLocal + 1440, eventLocal - 1440];
        let best: number | null = null;
        for (const c of candidates) {
          if (c < shiftStart - 60 || c > shiftEndAdj + 120) continue;
          const delta = c - shiftStart;
          if (best === null || Math.abs(delta) < Math.abs(best - shiftStart)) {
            best = c;
          }
        }
        return best === null ? null : best - shiftStart;
      };

      if (type === "clock-in" && settings.notifyLate) {
        const localNow = localMinutesInTz(actionTime);
        // Check shifts on today's local date AND yesterday's (for overnight shifts that started yesterday)
        const yesterday = new Date(actionTime.getTime() - 24 * 60 * 60 * 1000);
        const yLocal = localMinutesInTz(yesterday);
        const shiftsTodayResult = await storage.getShiftsByEmployeeAndDate(Number(employeeId), localNow.dateStr);
        const shiftsYesterdayResult = await storage.getShiftsByEmployeeAndDate(Number(employeeId), yLocal.dateStr);
        const candidateShifts = [...shiftsTodayResult, ...shiftsYesterdayResult];
        if (candidateShifts.length > 0) {
          const priorClockInTimes = await recentEntriesInWindow("clock-in");

          for (const shift of candidateShifts) {
            const shiftStart = tmins(shift.startTime);
            const shiftEnd = tmins(shift.endTime);
            const shiftDurMinutes = (shiftEnd <= shiftStart ? shiftEnd + 1440 : shiftEnd) - shiftStart;

            // Only attribute this clock-in to a shift if it falls in/around the shift window
            const offsetFromStart = minutesFromShiftStart(actionTime, shift);
            if (offsetFromStart === null) continue;

            // Skip if any prior clock-in already maps to the same shift window (already worked)
            const alreadyWorked = priorClockInTimes.some((t) => {
              const off = minutesFromShiftStart(t, shift);
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
        const localNow = localMinutesInTz(actionTime);
        const yesterday = new Date(actionTime.getTime() - 24 * 60 * 60 * 1000);
        const yLocal = localMinutesInTz(yesterday);
        const sessShifts = await storage.getShiftsByEmployeeAndDate(Number(employeeId), date);
        const sessShiftsAlt = date !== localNow.dateStr ? await storage.getShiftsByEmployeeAndDate(Number(employeeId), localNow.dateStr) : [];
        const sessShiftsYest = await storage.getShiftsByEmployeeAndDate(Number(employeeId), yLocal.dateStr);
        const candidateShifts = [...sessShifts, ...sessShiftsAlt, ...sessShiftsYest];
        if (candidateShifts.length > 0) {
          const priorClockOutTimes = await recentEntriesInWindow("clock-out");

          for (const shift of candidateShifts) {
            const shiftStart = tmins(shift.startTime);
            const shiftEnd = tmins(shift.endTime);
            const shiftEndAdj = shiftEnd <= shiftStart ? shiftEnd + 1440 : shiftEnd;
            const shiftDurMinutes = shiftEndAdj - shiftStart;

            const offsetFromStart = minutesFromShiftStart(actionTime, shift);
            if (offsetFromStart === null) continue;

            // Skip if a prior clock-out already maps within this shift window (already closed)
            const alreadyClosed = priorClockOutTimes.some((t) => {
              const off = minutesFromShiftStart(t, shift);
              return off !== null && off >= 0 && off <= shiftDurMinutes + 60;
            });
            if (alreadyClosed) continue;

            // Early = clock-out is more than threshold minutes BEFORE the shift end (relative to shift start)
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

    broadcastEntryUpdate(Number(employeeId), {
      type: entry.type,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
      source: "employee",
    });

    // Return the fresh entries list alongside the new entry so the kiosk can
    // update its cache atomically without a follow-up GET. Mirrors the logic
    // of GET /api/steepin/entries/:employeeId. Older clients ignore `entries`
    // and continue to invalidate / refetch as before — fully backward compatible.
    let updatedEntries = await storage.getTimeEntriesByEmployeeAndDate(Number(employeeId), date);
    const lastTypeAfter = updatedEntries.length > 0 ? updatedEntries[updatedEntries.length - 1].type : null;
    const hasOpenSessionAfter = lastTypeAfter === "clock-in" || lastTypeAfter === "break-start" || lastTypeAfter === "break-end";
    if (!hasOpenSessionAfter) {
      const openDateAfter = await storage.getOpenSessionDate(Number(employeeId));
      if (openDateAfter && openDateAfter !== date) {
        updatedEntries = await storage.getTimeEntriesByEmployeeAndDate(Number(employeeId), openDateAfter);
      }
    }

    res.status(201).json({ ...entry, entries: updatedEntries });
  });

  const broadcastEntriesChanged = (entries: TimeEntry[], type: string = "delete") => {
    const employeeIds = new Set(entries.map(entry => entry.employeeId));
    for (const employeeId of employeeIds) {
      broadcastEntryUpdate(employeeId, { type, timestamp: new Date().toISOString(), source: "manager" });
    }
  };

  router.patch("/api/steepin/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }
    const updateData: any = { source: "manager" };
    if (req.body.timestamp) {
      const timestamp = new Date(req.body.timestamp);
      if (Number.isNaN(timestamp.getTime())) {
        return res.status(400).json({ message: "Invalid timestamp" });
      }
      updateData.timestamp = timestamp;
    }
    if (req.body.type) {
      updateData.type = req.body.type;
    }
    if (req.body.role !== undefined) {
      updateData.role = req.body.role;
    }
    if (req.body.notes !== undefined) {
      const note = typeof req.body.notes === "string" ? req.body.notes.trim() : "";
      updateData.notes = note || null;
    }
    if (req.body.isUnpaid !== undefined) {
      updateData.isUnpaid = Boolean(req.body.isUnpaid);
    }
    const entry = await storage.updateTimeEntry(id, updateData, req.session.userId!);
    if (!entry) {
      console.warn(`[PATCH /api/steepin/entries/${id}] No row matched. ownerAccountId=${req.session.userId}, body=${JSON.stringify(req.body)}`);
      return res.status(404).json({ message: "Entry not found" });
    }
    console.log(`[PATCH /api/steepin/entries/${id}] OK. ownerAccountId=${req.session.userId}, fields=${Object.keys(updateData).join(",")}, savedNotes=${JSON.stringify(entry.notes)}, savedSource=${entry.source}`);
    broadcastEntryUpdate(entry.employeeId, {
      type: entry.type,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
      source: "manager",
    });
    res.json(entry);
  });

  router.post("/api/steepin/entries", requireRole("admin", "manager"), async (req, res) => {
    const { employeeId, type, date, timestamp, role, notes, isUnpaid } = req.body;
    const employeeIdNum = Number(employeeId);
    if (!Number.isFinite(employeeIdNum) || !type || typeof date !== "string" || !DATE_ONLY_RE.test(date)) {
      return res.status(400).json({ message: "Employee ID, type, and date are required" });
    }
    const entryTimestamp = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(entryTimestamp.getTime())) {
      return res.status(400).json({ message: "Invalid timestamp" });
    }
    const entry = await storage.createTimeEntryManualForOwner(
      req.session.userId!,
      employeeIdNum,
      type,
      date,
      entryTimestamp,
      role || null,
      typeof notes === "string" && notes.trim() ? notes.trim() : null,
      isUnpaid === true
    );
    if (!entry) return res.status(404).json({ message: "Employee not found" });
    broadcastEntryUpdate(employeeIdNum, {
      type: entry.type,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
      source: "manager",
    });
    res.status(201).json(entry);
  });

  router.delete("/api/steepin/entries", requireRole("admin", "manager"), async (req, res) => {
    const employeeId = Number(req.query.employeeId);
    const date = req.query.date as string;
    if (!Number.isFinite(employeeId) || typeof date !== "string" || !DATE_ONLY_RE.test(date)) {
      return res.status(400).json({ message: "Employee ID and date are required" });
    }
    const emp = await storage.getEmployee(employeeId);
    if (!emp || emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const deletedEntries = await storage.deleteTimeEntriesByEmployeeAndDateForOwner(employeeId, date, req.session.userId!);
    broadcastEntriesChanged(deletedEntries);
    res.status(204).send();
  });

  router.delete("/api/steepin/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    const entryId = Number(req.params.id);
    if (!Number.isFinite(entryId)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }
    const deletedEntry = await storage.deleteTimeEntryForOwner(entryId, req.session.userId!);
    if (!deletedEntry) return res.status(404).json({ message: "Entry not found" });
    broadcastEntriesChanged([deletedEntry]);
    res.status(204).send();
  });

  router.post("/api/steepin/entries/delete-batch", requireRole("admin", "manager"), async (req, res) => {
    const { ids, employeeId, date } = req.body;
    if (employeeId !== undefined && date !== undefined) {
      const employeeIdNum = Number(employeeId);
      const dateStr = String(date);
      if (!Number.isFinite(employeeIdNum) || !DATE_ONLY_RE.test(dateStr)) {
        return res.status(400).json({ message: "Employee ID and date are required" });
      }
      const ownerAccountId = req.session.userId!;
      const empIds = await storage.getEmployeeIdsByOwner(ownerAccountId);
      if (!empIds.includes(employeeIdNum)) {
        return res.status(403).json({ message: "Not authorized" });
      }
      const deletedEntries = await storage.deleteTimeEntriesByEmployeeAndDateForOwner(employeeIdNum, dateStr, ownerAccountId);
      broadcastEntriesChanged(deletedEntries);
      return res.status(204).send();
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No IDs provided" });
    }
    const numericIds = ids.map(Number);
    if (!numericIds.every(Number.isFinite)) {
      return res.status(400).json({ message: "Invalid entry IDs" });
    }
    const ownerAccountId = req.session.userId!;
    const deletedEntries = await storage.batchDeleteTimeEntriesByIds(numericIds, ownerAccountId);
    if (deletedEntries.length === 0) return res.status(404).json({ message: "Entries not found" });
    broadcastEntriesChanged(deletedEntries);
    res.status(204).send();
  });

  // === CSV IMPORT ===
  router.post("/api/timesheets/import-csv", requireRole("admin", "manager"), async (req, res) => {
    try {
      const ownerAccountId = req.session.userId!;
      const { rows, timezoneOffset = 0, skipBackup = false } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
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
          await storage.createTimesheetBackup(ownerAccountId, "Before CSV Import");
        } catch (_) {}
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
      const toInsert: Array<{ employeeId: number; type: string; date: string; timestamp: Date; role?: string | null; notes?: string | null; isUnpaid?: boolean }> = [];

      for (const row of rows) {
        const { employeeName, date, clockIn, clockOut, breaks, role, notes } = row;
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

      res.json({ created, replaced, newEmployees: newEmployeeNames, newRoles: newRoleNames });
    } catch (err: any) {
      console.error("CSV import error:", err);
      res.status(500).json({ message: err.message || "Import failed" });
    }
  });
}
