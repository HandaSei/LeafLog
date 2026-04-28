import type { Express } from "express";
import { createServer, type Server } from "http";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { storage, pool } from "./storage";
import { insertEmployeeSchema, insertShiftSchema, breakPolicySchema, notificationSettingsSchema, type TimeEntry } from "@shared/schema";
import { setupSession, registerAuthRoutes, requireAuth, requireRole } from "./auth";
import { format, subDays, addDays, parseISO, differenceInMinutes } from "date-fns";
import { addSSEClient, removeSSEClient, broadcastEntryUpdate } from "./sse";

const autoCloseCache = new Map<number, number>();
const AUTO_CLOSE_CACHE_TTL_MS = 2 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

type RecentEntryRow = {
  id: number;
  employee_id: number;
  type: string;
  timestamp: Date;
  date: string;
  source: string | null;
};

function getDateRangeQuery(req: any) {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  if (!from && !to) return null;
  if (!from || !to || !DATE_ONLY_RE.test(from) || !DATE_ONLY_RE.test(to) || from > to) {
    return { error: "Valid from and to dates are required" } as const;
  }
  return { from, to } as const;
}

function toDateOnly(value: string | Date): string {
  return value instanceof Date ? format(value, "yyyy-MM-dd") : value.substring(0, 10);
}

async function autoCloseStaleSession(employeeId: number): Promise<void> {
  const cacheNow = Date.now();
  const lastCheck = autoCloseCache.get(employeeId);
  if (lastCheck && cacheNow - lastCheck < AUTO_CLOSE_CACHE_TTL_MS) {
    return;
  }
  autoCloseCache.set(employeeId, cacheNow);

  const openDate = await storage.getOpenSessionDate(employeeId);
  if (!openDate) return;

  const entries = await storage.getTimeEntriesByEmployeeAndDate(employeeId, openDate);
  const clockIns = entries.filter((e) => e.type === "clock-in");
  if (clockIns.length === 0) return;

  const lastClockIn = clockIns[clockIns.length - 1];
  const lastClockInTime = new Date(lastClockIn.timestamp);
  const now = new Date();
  const hoursOpen = differenceInMinutes(now, lastClockInTime) / 60;

  // Extend limit to 24h if the employee took a break after 10h (signaling they're actually still working)
  const breakAfter10h = entries.some(
    (e) =>
      e.type === "break-start" &&
      new Date(e.timestamp).getTime() > lastClockInTime.getTime() + 10 * 60 * 60 * 1000
  );
  const limitHours = breakAfter10h ? 24 : 16;

  if (hoursOpen > limitHours) {
    const closeTime = new Date(lastClockInTime.getTime() + limitHours * 60 * 60 * 1000);
    const closeDate = format(closeTime, "yyyy-MM-dd");
    await storage.createTimeEntryManual(
      employeeId,
      "clock-out",
      closeDate,
      closeTime,
      null,
      `auto-closed after ${limitHours}h`,
      false,
      "auto-close"
    );
    broadcastEntryUpdate(employeeId, { type: "clock-out", timestamp: closeTime.toISOString(), source: "auto-close" });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupSession(app);

  const router = Router();

  router.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.removeHeader("ETag");
    next();
  });

  app.set("etag", false);

  registerAuthRoutes(router);

  // === EMPLOYEES ===
  router.get("/api/employees", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const emps = await storage.getEmployees(ownerAccountId);
    res.json(emps);
  });

  router.get("/api/employees/:id", requireAuth, async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    if (emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    res.json(emp);
  });

  router.post("/api/employees", requireRole("admin", "manager"), async (req, res) => {
    const parsed = insertEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const emp = await storage.createEmployee({ ...parsed.data, ownerAccountId: req.session.userId });
    res.status(201).json(emp);
  });

  router.patch("/api/employees/:id", requireRole("admin", "manager"), async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    if (emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const partial = insertEmployeeSchema.partial().safeParse(req.body);
    if (!partial.success) {
      return res.status(400).json({ message: partial.error.issues[0].message });
    }
    const updated = await storage.updateEmployee(Number(req.params.id), partial.data);
    res.json(updated);
  });

  router.delete("/api/employees/:id", requireRole("admin", "manager"), async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    if (emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    await storage.deleteEmployee(Number(req.params.id));
    res.status(204).send();
  });

  // === EMPLOYEE SHIFT ROLES ===
  router.post("/api/employees/:id/update-shift-roles", requireRole("admin", "manager"), async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    if (emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { role, color } = req.body;
    if (!role || !color) return res.status(400).json({ message: "Role and color are required" });
    await storage.updateShiftRolesForEmployee(Number(req.params.id), role, color);
    res.json({ updated: true });
  });

  // === SHIFTS ===
  router.get("/api/shifts", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const range = getDateRangeQuery(req);
    if (range && "error" in range) return res.status(400).json({ message: range.error });
    if (range) {
      const shifts = await storage.getShiftsByDateRange(ownerAccountId, range.from, range.to);
      return res.json(shifts);
    }
    const allShifts = await storage.getShifts(ownerAccountId);
    res.json(allShifts);
  });

  router.get("/api/shifts/:id", requireAuth, async (req, res) => {
    const shift = await storage.getShift(Number(req.params.id));
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    res.json(shift);
  });

  router.post("/api/shifts", requireRole("admin", "manager"), async (req, res) => {
    const parsed = insertShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const shiftData = parsed.data as {
      employeeId: number;
      date: string;
      startTime: string;
      endTime: string;
      [key: string]: any;
    };
    const emp = await storage.getEmployee(shiftData.employeeId);
    if (!emp || emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const toMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const currentDate = shiftData.date;
    const prevDateStr = format(subDays(parseISO(currentDate), 1), "yyyy-MM-dd");
    const nextDateStr = format(addDays(parseISO(currentDate), 1), "yyyy-MM-dd");
    const nearbyShifts = await storage.getShiftsByEmployeeAndDateRange(shiftData.employeeId, prevDateStr, nextDateStr);
    const shiftsOnDate = (date: string) => nearbyShifts.filter((s) => toDateOnly(s.date) === date);
    const existingShifts = shiftsOnDate(currentDate);
    const newStart = toMinutes(shiftData.startTime);
    const newEnd = toMinutes(shiftData.endTime);
    const newEndAdj = newEnd <= newStart ? newEnd + 1440 : newEnd;
    const excludeId = req.body.excludeId ? Number(req.body.excludeId) : undefined;
    const conflict = existingShifts.find((s) => {
      if (excludeId && s.id === excludeId) return false;
      const sStart = toMinutes(s.startTime);
      const sEnd = toMinutes(s.endTime);
      const sEndAdj = sEnd <= sStart ? sEnd + 1440 : sEnd;
      return newStart < sEndAdj && newEndAdj > sStart;
    });
    if (conflict) {
      return res.status(409).json({ message: `This shift overlaps with an existing shift (${conflict.startTime.slice(0,5)}–${conflict.endTime.slice(0,5)}) for this employee.` });
    }
    // Previous-day check: does an overnight shift from D-1 extend into D and overlap with this shift?
    const prevShifts = shiftsOnDate(prevDateStr);
    const prevConflict = prevShifts.find((s) => {
      const sStart = toMinutes(s.startTime);
      const sEnd = toMinutes(s.endTime);
      if (sEnd > sStart) return false; // not overnight
      // overnight portion on date D covers [0, sEnd]
      return newStart < sEnd;
    });
    if (prevConflict) {
      return res.status(409).json({ message: `This shift overlaps with an overnight shift from the previous day (${prevConflict.startTime.slice(0,5)}–${prevConflict.endTime.slice(0,5)}) for this employee.` });
    }
    // Next-day check: only needed when new shift is itself overnight
    if (newEnd <= newStart) {
      const nextShifts = shiftsOnDate(nextDateStr);
      const nextConflict = nextShifts.find((s) => {
        if (excludeId && s.id === excludeId) return false;
        const sStart = toMinutes(s.startTime);
        // our overnight tail on D+1 covers [0, newEnd]
        return newEnd > sStart;
      });
      if (nextConflict) {
        return res.status(409).json({ message: `This overnight shift overlaps with an existing shift on the next day (${nextConflict.startTime.slice(0,5)}–${nextConflict.endTime.slice(0,5)}) for this employee.` });
      }
    }
    // Proximity warning: new shift is within 20 minutes of an existing shift (non-overlapping)
    if (!req.body.allowProximity) {
      const nearbyShift = existingShifts.find((s) => {
        if (excludeId && s.id === excludeId) return false;
        const sStart = toMinutes(s.startTime);
        const sEnd = toMinutes(s.endTime);
        const sEndAdj = sEnd <= sStart ? sEnd + 1440 : sEnd;
        const gapAfterExisting = newStart - sEndAdj;   // gap: existing ends, new starts
        const gapBeforeExisting = sStart - newEndAdj;  // gap: new ends, existing starts
        return (gapAfterExisting >= 0 && gapAfterExisting < 20) ||
               (gapBeforeExisting >= 0 && gapBeforeExisting < 20);
      });
      if (nearbyShift) {
        return res.status(409).json({
          type: "proximity-warning",
          nearbyShift: { id: nearbyShift.id, startTime: nearbyShift.startTime.slice(0, 5), endTime: nearbyShift.endTime.slice(0, 5) },
          message: `This shift is less than 20 minutes away from an existing shift (${nearbyShift.startTime.slice(0,5)}–${nearbyShift.endTime.slice(0,5)}). Consider merging them into one shift instead.`,
        });
      }
    }
    const shift = await storage.createShift(shiftData);
    res.status(201).json(shift);
  });

  router.patch("/api/shifts/:id", requireRole("admin", "manager"), async (req, res) => {
    const partial = insertShiftSchema.partial().safeParse(req.body);
    if (!partial.success) {
      return res.status(400).json({ message: partial.error.issues[0].message });
    }
    const existing = await storage.getShift(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Shift not found" });
    const emp = await storage.getEmployee(existing.employeeId);
    if (!emp || emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const shiftPatch = partial.data as Partial<{
      employeeId: number;
      date: string;
      startTime: string;
      endTime: string;
      [key: string]: any;
    }>;
    const employeeId = shiftPatch.employeeId ?? existing.employeeId;
    const date = shiftPatch.date ?? existing.date;
    const startTime = shiftPatch.startTime ?? existing.startTime;
    const endTime = shiftPatch.endTime ?? existing.endTime;
    const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const currentDate = toDateOnly(date);
    const prevDateStr2 = format(subDays(parseISO(currentDate), 1), "yyyy-MM-dd");
    const nextDateStr2 = format(addDays(parseISO(currentDate), 1), "yyyy-MM-dd");
    const nearbyShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, prevDateStr2, nextDateStr2);
    const shiftsOnDate = (date: string) => nearbyShifts.filter((s) => toDateOnly(s.date) === date);
    const existingShifts = shiftsOnDate(currentDate);
    const newStart = toMinutes(startTime);
    const newEnd = toMinutes(endTime);
    const newEndAdj = newEnd <= newStart ? newEnd + 1440 : newEnd;
    const conflict = existingShifts.find((s) => {
      if (s.id === Number(req.params.id)) return false;
      const sStart = toMinutes(s.startTime);
      const sEnd = toMinutes(s.endTime);
      const sEndAdj = sEnd <= sStart ? sEnd + 1440 : sEnd;
      return newStart < sEndAdj && newEndAdj > sStart;
    });
    if (conflict) {
      return res.status(409).json({ message: `This shift overlaps with an existing shift (${conflict.startTime.slice(0,5)}–${conflict.endTime.slice(0,5)}) for this employee.` });
    }
    // Previous-day check: does an overnight shift from D-1 extend into D and overlap?
    const prevShifts2 = shiftsOnDate(prevDateStr2);
    const prevConflict2 = prevShifts2.find((s) => {
      if (s.id === Number(req.params.id)) return false;
      const sStart = toMinutes(s.startTime);
      const sEnd = toMinutes(s.endTime);
      if (sEnd > sStart) return false;
      return newStart < sEnd;
    });
    if (prevConflict2) {
      return res.status(409).json({ message: `This shift overlaps with an overnight shift from the previous day (${prevConflict2.startTime.slice(0,5)}–${prevConflict2.endTime.slice(0,5)}) for this employee.` });
    }
    // Next-day check: only when this shift is itself overnight
    if (newEnd <= newStart) {
      const nextShifts2 = shiftsOnDate(nextDateStr2);
      const nextConflict2 = nextShifts2.find((s) => {
        if (s.id === Number(req.params.id)) return false;
        const sStart = toMinutes(s.startTime);
        return newEnd > sStart;
      });
      if (nextConflict2) {
        return res.status(409).json({ message: `This overnight shift overlaps with an existing shift on the next day (${nextConflict2.startTime.slice(0,5)}–${nextConflict2.endTime.slice(0,5)}) for this employee.` });
      }
    }
    const shift = await storage.updateShift(Number(req.params.id), shiftPatch);
    res.json(shift);
  });

  router.delete("/api/shifts/:id", requireRole("admin", "manager"), async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

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

  // === TIMESHEET BACKUPS ===
  router.get("/api/backups", requireRole("admin", "manager"), async (req, res) => {
    try {
      const backups = await storage.getTimesheetBackups(req.session.userId!);
      res.json(backups);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  router.post("/api/backups", requireRole("admin", "manager"), async (req, res) => {
    try {
      const backup = await storage.createTimesheetBackup(req.session.userId!, "Manual backup");
      res.json({ id: backup.id, label: backup.label, entryCount: backup.entryCount, createdAt: backup.createdAt });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  router.post("/api/backups/:id/restore", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid backup id" });
      const restored = await storage.restoreTimesheetBackup(id, req.session.userId!);
      res.json({ restored });
    } catch (err: any) {
      res.status(err.message === "Backup not found" ? 404 : 500).json({ message: err.message });
    }
  });

  router.delete("/api/backups/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid backup id" });
      await storage.deleteTimesheetBackup(id, req.session.userId!);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === CUSTOM ROLES ===
  router.get("/api/roles", requireRole("admin", "manager"), async (req, res) => {
    const roles = await storage.getCustomRoles(req.session.userId!);
    res.json(roles);
  });

  router.post("/api/roles", requireRole("admin", "manager"), async (req, res) => {
    const { name, color } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Role name is required" });
    }
    const existing = await storage.getCustomRoles(req.session.userId!);
    const duplicate = existing.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
    if (duplicate) {
      return res.status(400).json({ message: "A role with this name already exists" });
    }
    const role = await storage.createCustomRole(req.session.userId!, name.trim(), color);
    res.status(201).json(role);
  });

  router.patch("/api/roles/:id", requireRole("admin", "manager"), async (req, res) => {
    const { name, color } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Role name is required" });
    }
    const existing = await storage.getCustomRoles(req.session.userId!);
    const currentRole = existing.find((r) => r.id === Number(req.params.id));
    const duplicate = existing.find((r) => r.name.toLowerCase() === name.trim().toLowerCase() && r.id !== Number(req.params.id));
    if (duplicate) {
      return res.status(400).json({ message: "A role with this name already exists" });
    }
    const role = await storage.updateCustomRole(Number(req.params.id), name.trim(), color);
    if (!role) return res.status(404).json({ message: "Role not found" });
    if (color && currentRole) {
      await storage.updateEmployeeColorsByRole(name.trim(), color, req.session.userId!);
      
      // Update ALL existing shifts for these employees to the new color
      await pool.query(
        `UPDATE shifts 
         SET color = $1 
         WHERE employee_id IN (
           SELECT id FROM employees 
           WHERE role = $2 AND owner_account_id = $3
         )`,
        [color, name.trim(), req.session.userId!]
      );

      if (currentRole.name !== name.trim()) {
        await pool.query(
          "UPDATE employees SET role = $1 WHERE role = $2 AND owner_account_id = $3",
          [name.trim(), currentRole.name, req.session.userId!]
        );
      }
    }
    res.json(role);
  });

  router.delete("/api/roles/:id", requireRole("admin", "manager"), async (req, res) => {
    await storage.deleteCustomRole(Number(req.params.id));
    res.status(204).send();
  });

  // === ACCOUNT DELETION ===
  router.delete("/api/auth/account", requireAuth, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Password is required" });
    const account = await storage.getAccount(req.session.userId!);
    if (!account) return res.status(404).json({ message: "Account not found" });
    const valid = await bcrypt.compare(password, account.password);
    if (!valid) return res.status(401).json({ message: "Incorrect password" });
    await storage.deleteAccount(account.id);
    req.session.destroy(() => {});
    res.status(204).send();
  });

  // === FEEDBACK ===
  router.post("/api/feedback", requireRole("admin", "manager"), async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ message: "Feedback message is required" });
    }
    const accountId = req.session.userId!;
    const count = await storage.getFeedbackCount24h(accountId);
    if (count >= 3) {
      return res.status(429).json({ message: "Feedback limit reached. You can send up to 3 messages every 24 hours." });
    }
    const entry = await storage.createFeedback(accountId, message.trim());
    res.status(201).json(entry);
  });

  router.get("/api/feedback", requireRole("admin"), async (_req, res) => {
    const entries = await storage.getAllFeedback();
    res.json(entries);
  });

  router.get("/api/feedback/remaining", requireRole("admin", "manager"), async (req, res) => {
    const count = await storage.getFeedbackCount24h(req.session.userId!);
    res.json({ remaining: Math.max(0, 3 - count) });
  });

  // === BREAK POLICY ===
  router.get("/api/settings/break-policy", requireAuth, async (req, res) => {
    const policy = await storage.getBreakPolicy(req.session.userId!);
    res.json(policy);
  });

  router.patch("/api/settings/break-policy", requireRole("admin", "manager"), async (req, res) => {
    const parsed = breakPolicySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    await storage.updateBreakPolicy(req.session.userId!, parsed.data.paidBreakMinutes ?? null, parsed.data.maxBreakMinutes ?? null);
    const policy = await storage.getBreakPolicy(req.session.userId!);
    res.json(policy);
  });

  router.patch("/api/employees/:id/break-policy", requireRole("admin", "manager"), async (req, res) => {
    const employeeId = Number(req.params.id);
    if (isNaN(employeeId)) return res.status(400).json({ message: "Invalid employee id" });
    const parsed = breakPolicySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const updated = await storage.updateEmployeeBreakPolicy(
      employeeId, req.session.userId!,
      parsed.data.paidBreakMinutes ?? null,
      parsed.data.maxBreakMinutes ?? null
    );
    if (!updated) return res.status(404).json({ message: "Employee not found" });
    res.json(updated);
  });

  // === NOTIFICATION SETTINGS ===
  router.get("/api/settings/notifications", requireAuth, async (req, res) => {
    const settings = await storage.getNotificationSettings(req.session.userId!);
    res.json(settings);
  });

  router.patch("/api/settings/notifications", requireRole("admin", "manager"), async (req, res) => {
    const parsed = notificationSettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    await storage.updateNotificationSettings(req.session.userId!, parsed.data);
    const settings = await storage.getNotificationSettings(req.session.userId!);
    res.json(settings);
  });

  // === NOTIFICATIONS ===
  router.get("/api/notifications", requireAuth, async (req, res) => {
    const notifs = await storage.getNotificationsByAccount(req.session.userId!);
    res.json(notifs);
  });

  router.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    const count = await storage.getUnreadNotificationCount(req.session.userId!);
    res.json({ count });
  });

  router.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    await storage.markNotificationRead(Number(req.params.id), req.session.userId!);
    res.json({ success: true });
  });

  router.patch("/api/notifications/read-all", requireAuth, async (req, res) => {
    await storage.markAllNotificationsRead(req.session.userId!);
    res.json({ success: true });
  });

  // === APPROVAL REQUESTS ===
  router.get("/api/approval-requests", requireAuth, async (req, res) => {
    const status = req.query.status as string | undefined;
    const requests = await storage.getApprovalRequestsByOwner(req.session.userId!, status);
    res.json(requests);
  });

  router.get("/api/approval-requests/by-employee", requireAuth, async (req, res) => {
    const employeeId = Number(req.query.employeeId);
    const entryDate = req.query.entryDate as string;
    if (!employeeId || !entryDate) {
      return res.status(400).json({ message: "employeeId and entryDate are required" });
    }
    const employee = await storage.getEmployee(employeeId);
    if (!employee || employee.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    const requests = await storage.getApprovalRequestsByEmployeeAndDate(employeeId, entryDate);
    res.json(requests);
  });

  router.patch("/api/approval-requests/:id", requireRole("admin", "manager"), async (req, res) => {
    const { status, managerResponse } = req.body;
    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Status must be 'approved' or 'rejected'" });
    }

    const updated = await storage.updateApprovalRequest(Number(req.params.id), {
      status,
      managerResponse: managerResponse || null,
      resolvedAt: new Date(),
    }, req.session.userId!);

    if (!updated) return res.status(404).json({ message: "Approval request not found" });

    if (status === "rejected" && updated.type === "gap-classification") {
      const data = JSON.parse(updated.requestData || "{}");
      if (data.action === "break") {
        const entries = await storage.getTimeEntriesByEmployeeAndDate(updated.employeeId, updated.entryDate!);
        const gapStart = new Date(data.gapStartTime);
        const gapEnd = new Date(data.gapEndTime);
        for (const entry of entries) {
          const ts = new Date(entry.timestamp);
          if (entry.type === "break-start" && Math.abs(ts.getTime() - gapStart.getTime()) < 60000) {
            await storage.deleteTimeEntry(entry.id);
          }
          if (entry.type === "break-end" && Math.abs(ts.getTime() - gapEnd.getTime()) < 60000) {
            await storage.deleteTimeEntry(entry.id);
          }
        }
        await storage.createTimeEntryManual(updated.employeeId, "clock-out", updated.entryDate!, gapStart);
      } else if (data.action === "working") {
        await storage.createTimeEntryManual(updated.employeeId, "clock-out", updated.entryDate!, new Date(data.gapStartTime));
      }
    }

    res.json(updated);
  });

  // === BOOTSTRAP — batches all startup data into one round-trip ===
  router.get("/api/bootstrap", async (req, res) => {
    if (!req.session.userId) {
      return res.json({ auth: { authenticated: false } });
    }
    const accountId = req.session.userId;
    const isSteepInSession = req.session.steepinMode ?? false;
    const dashboardToday =
      typeof req.query.dashboardToday === "string" && DATE_ONLY_RE.test(req.query.dashboardToday)
        ? req.query.dashboardToday
        : format(new Date(), "yyyy-MM-dd");
    const dashboardYesterday =
      typeof req.query.dashboardYesterday === "string" && DATE_ONLY_RE.test(req.query.dashboardYesterday)
        ? req.query.dashboardYesterday
        : format(subDays(parseISO(dashboardToday), 1), "yyyy-MM-dd");

    // Start employees query first; if in SteepIn mode, kick off the recent-entries
    // query as soon as employee IDs are known so it overlaps with the remaining
    // queries below instead of running sequentially after them.
    const employeesPromise = storage.getEmployees(accountId);
    const recentEntriesPromise: Promise<{ rows: RecentEntryRow[] }> | null = isSteepInSession
      ? employeesPromise.then(async (emps) => {
          const activeEmps = emps.filter(
            (e: any) => e.status === "active" && !e.hiddenFromSteepin,
          );
          const empIds = activeEmps.map((e) => e.id);
          if (empIds.length === 0) return { rows: [] };
          return pool.query<RecentEntryRow>(
            `SELECT id, employee_id, type, timestamp, entry_date::text as date, source 
             FROM time_entries 
             WHERE employee_id = ANY($1) 
             AND timestamp > NOW() - INTERVAL '36 hours'
             ORDER BY employee_id, timestamp ASC`,
            [empIds],
          );
        })
      : null;

    const [account, employees, roles, breakPolicy, notificationCount] = await Promise.all([
      storage.getAccount(accountId),
      employeesPromise,
      storage.getCustomRoles(accountId),
      storage.getBreakPolicy(accountId),
      storage.getUnreadNotificationCount(accountId),
    ]);
    if (!account) {
      return res.json({ auth: { authenticated: false } });
    }
    const authUser = {
      id: account.id,
      username: account.username,
      role: account.role,
      employeeId: account.employeeId ?? null,
      agencyName: account.agencyName ?? null,
      email: account.email ?? null,
    };
    const isSteepIn = isSteepInSession;
    const steepinEmployees = isSteepIn
      ? employees.filter((e: any) => e.status === "active" && !e.hiddenFromSteepin)
      : employees;
    const response: any = {
      auth: {
        authenticated: true,
        user: authUser,
        employee: null,
        steepinMode: isSteepIn,
      },
      employees: steepinEmployees,
      roles,
      breakPolicy,
      notificationCount,
    };
    response.steepinThemeSettings = {
      mode: account.steepinThemeMode || "light",
      dayStartHour: account.steepinDayStartHour ?? 7,
      nightStartHour: account.steepinNightStartHour ?? 19,
    };

    if (!isSteepIn && (account.role === "admin" || account.role === "manager")) {
      const [dashboardShifts, dashboardEntries, dashboardOpenSessionEntries] = await Promise.all([
        storage.getShiftsByDateRange(accountId, dashboardYesterday, dashboardToday),
        storage.getTimeEntriesByDate(dashboardToday, accountId),
        storage.getOpenSessionEntries(accountId),
      ]);
      response.dashboard = {
        today: dashboardToday,
        yesterday: dashboardYesterday,
        shifts: dashboardShifts,
        entries: dashboardEntries,
        openSessionEntries: dashboardOpenSessionEntries,
      };
    }

    if (isSteepIn) {
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const activeEmps = steepinEmployees;
      
      const empIds = activeEmps.map(e => e.id);
      if (empIds.length > 0 && recentEntriesPromise) {
        // Awaiting a promise that was started earlier in parallel with the other bootstrap queries
        const recentEntries = await recentEntriesPromise;
        
        const entriesByEmp: Record<number, any[]> = {};
        empIds.forEach(id => entriesByEmp[id] = []);
        recentEntries.rows.forEach(row => {
          entriesByEmp[row.employee_id].push({
            id: row.id,
            employeeId: row.employee_id,
            type: row.type,
            timestamp: row.timestamp,
            date: row.date,
            source: row.source
          });
        });

        const finalMap: Record<number, any[]> = {};
        empIds.forEach(id => {
          const allRecent = entriesByEmp[id];
          const todayEntries = allRecent.filter(e => e.date === todayStr);
          
          if (todayEntries.length > 0) {
            finalMap[id] = todayEntries;
          } else if (allRecent.length > 0) {
            // Check if the absolute latest is an open session from yesterday
            const latest = allRecent[allRecent.length - 1];
            if (latest.type !== 'clock-out') {
              finalMap[id] = allRecent.filter(e => e.date === latest.date);
            } else {
              finalMap[id] = [];
            }
          } else {
            finalMap[id] = [];
          }
        });

        response.steepinEntries = finalMap;
      } else {
        response.steepinEntries = {};
      }
    }
    res.json(response);
  });

  router.get("/api/settings/steepin-theme", requireAuth, async (req, res) => {
    const accountId = req.session.userId!;
    const result = await pool.query(
      `SELECT steepin_theme_mode, steepin_day_start_hour, steepin_night_start_hour
       FROM accounts WHERE id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    res.json({
      mode: row?.steepin_theme_mode || "light",
      dayStartHour: row?.steepin_day_start_hour ?? 7,
      nightStartHour: row?.steepin_night_start_hour ?? 19,
    });
  });

  router.patch("/api/settings/steepin-theme", requireRole("admin", "manager"), async (req, res) => {
    const { mode, dayStartHour, nightStartHour } = req.body;
    const accountId = req.session.userId!;
    const validModes = ["light", "dark", "auto"];
    if (mode && !validModes.includes(mode)) {
      return res.status(400).json({ message: "Invalid theme mode" });
    }
    const updates: any = {};
    if (mode) updates.steepinThemeMode = mode;
    if (dayStartHour !== undefined) updates.steepinDayStartHour = Math.max(0, Math.min(23, Number(dayStartHour)));
    if (nightStartHour !== undefined) updates.steepinNightStartHour = Math.max(0, Math.min(23, Number(nightStartHour)));
    await pool.query(
      `UPDATE accounts SET steepin_theme_mode = COALESCE($1, steepin_theme_mode), steepin_day_start_hour = COALESCE($2, steepin_day_start_hour), steepin_night_start_hour = COALESCE($3, steepin_night_start_hour) WHERE id = $4`,
      [updates.steepinThemeMode || null, updates.steepinDayStartHour ?? null, updates.steepinNightStartHour ?? null, accountId]
    );
    const result = {
      mode: updates.steepinThemeMode || mode,
      dayStartHour: updates.steepinDayStartHour ?? dayStartHour,
      nightStartHour: updates.steepinNightStartHour ?? nightStartHour,
    };
    res.json(result);
  });

  // === GLOBAL PAY CONFIG ===
  router.get("/api/settings/global-pay", requireRole("admin", "manager"), async (req, res) => {
    const accountId = req.session.userId!;
    const result = await pool.query(
      `SELECT global_special_day_enabled, global_special_day_of_week, global_special_day_rate, global_custom_pay_days FROM accounts WHERE id = $1`,
      [accountId]
    );
    const row = result.rows[0];
    res.json({
      specialDayEnabled: row?.global_special_day_enabled ?? false,
      specialDayOfWeek: row?.global_special_day_of_week ?? null,
      specialDayRate: row?.global_special_day_rate ?? null,
      customPayDays: row?.global_custom_pay_days ?? null,
    });
  });

  router.patch("/api/settings/global-pay", requireRole("admin", "manager"), async (req, res) => {
    const accountId = req.session.userId!;
    const { specialDayEnabled, specialDayOfWeek, specialDayRate, customPayDays } = req.body;
    await pool.query(
      `UPDATE accounts SET
        global_special_day_enabled = COALESCE($1, global_special_day_enabled),
        global_special_day_of_week = $2,
        global_special_day_rate = $3,
        global_custom_pay_days = $4
      WHERE id = $5`,
      [
        specialDayEnabled ?? false,
        specialDayOfWeek ?? null,
        specialDayRate ?? null,
        customPayDays ?? null,
        accountId,
      ]
    );
    res.json({
      specialDayEnabled: specialDayEnabled ?? false,
      specialDayOfWeek: specialDayOfWeek ?? null,
      specialDayRate: specialDayRate ?? null,
      customPayDays: customPayDays ?? null,
    });
  });

  // === KIOSK DEVICES ===
  router.post("/api/devices/register", requireAuth, async (req, res) => {
    const { deviceId, deviceName } = req.body;
    if (!deviceId || typeof deviceId !== "string") {
      return res.status(400).json({ message: "deviceId is required" });
    }
    const name = (typeof deviceName === "string" && deviceName.trim()) ? deviceName.trim() : "Unknown Device";
    const ownerAccountId = req.session.userId!;
    const device = await storage.registerKioskDevice(ownerAccountId, deviceId, name);
    res.json(device);
  });

  router.get("/api/devices/check", requireAuth, async (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId || typeof deviceId !== "string") {
      return res.status(400).json({ message: "deviceId is required" });
    }
    const ownerAccountId = req.session.userId!;
    const status = await storage.getKioskDeviceStatus(ownerAccountId, deviceId);
    res.json({ isLocked: status?.isLocked ?? false });
  });

  router.get("/api/devices", requireRole("admin", "manager"), async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const devices = await storage.getKioskDevices(ownerAccountId);
    res.json(devices);
  });

  router.patch("/api/devices/:id/lock", requireRole("admin", "manager"), async (req, res) => {
    const { isLocked } = req.body;
    const ownerAccountId = req.session.userId!;
    const device = await storage.updateKioskDeviceLock(Number(req.params.id), ownerAccountId, !!isLocked);
    if (!device) return res.status(404).json({ message: "Device not found" });
    res.json(device);
  });

  router.patch("/api/devices/:id/rename", requireRole("admin", "manager"), async (req, res) => {
    const { deviceName } = req.body;
    if (!deviceName || typeof deviceName !== "string" || !deviceName.trim()) {
      return res.status(400).json({ message: "deviceName is required" });
    }
    const ownerAccountId = req.session.userId!;
    const device = await storage.renameKioskDevice(Number(req.params.id), ownerAccountId, deviceName.trim());
    if (!device) return res.status(404).json({ message: "Device not found" });
    res.json(device);
  });

  router.delete("/api/devices/:id", requireRole("admin", "manager"), async (req, res) => {
    const ownerAccountId = req.session.userId!;
    await storage.deleteKioskDevice(Number(req.params.id), ownerAccountId);
    res.json({ success: true });
  });

  // === ADMIN ===
  router.get("/api/admin/accounts", requireRole("admin"), async (_req, res) => {
    const allAccounts = await storage.getAllAccounts();
    res.json(allAccounts);
  });

  app.use(router);

  return httpServer;
}
