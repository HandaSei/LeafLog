import type { Express } from "express";
import { createServer, type Server } from "http";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { storage, pool } from "./storage";
import { insertEmployeeSchema, insertShiftSchema, breakPolicySchema, notificationSettingsSchema } from "@shared/schema";
import { setupSession, registerAuthRoutes, requireAuth, requireRole } from "./auth";
import { format, subDays, addDays, parseISO, differenceInMinutes } from "date-fns";

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
    const emp = await storage.getEmployee(parsed.data.employeeId);
    if (!emp || emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const existingShifts = await storage.getShiftsByEmployeeAndDate(parsed.data.employeeId, parsed.data.date);
    const toMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const newStart = toMinutes(parsed.data.startTime);
    const newEnd = toMinutes(parsed.data.endTime);
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
    const prevDateStr = format(subDays(parseISO(parsed.data.date), 1), "yyyy-MM-dd");
    const prevShifts = await storage.getShiftsByEmployeeAndDate(parsed.data.employeeId, prevDateStr);
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
      const nextDateStr = format(addDays(parseISO(parsed.data.date), 1), "yyyy-MM-dd");
      const nextShifts = await storage.getShiftsByEmployeeAndDate(parsed.data.employeeId, nextDateStr);
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
    const shift = await storage.createShift(parsed.data);
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
    const employeeId = partial.data.employeeId ?? existing.employeeId;
    const date = partial.data.date ?? existing.date;
    const startTime = partial.data.startTime ?? existing.startTime;
    const endTime = partial.data.endTime ?? existing.endTime;
    const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const existingShifts = await storage.getShiftsByEmployeeAndDate(employeeId, date);
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
    const prevDateStr2 = format(subDays(parseISO(date), 1), "yyyy-MM-dd");
    const prevShifts2 = await storage.getShiftsByEmployeeAndDate(employeeId, prevDateStr2);
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
      const nextDateStr2 = format(addDays(parseISO(date), 1), "yyyy-MM-dd");
      const nextShifts2 = await storage.getShiftsByEmployeeAndDate(employeeId, nextDateStr2);
      const nextConflict2 = nextShifts2.find((s) => {
        if (s.id === Number(req.params.id)) return false;
        const sStart = toMinutes(s.startTime);
        return newEnd > sStart;
      });
      if (nextConflict2) {
        return res.status(409).json({ message: `This overnight shift overlaps with an existing shift on the next day (${nextConflict2.startTime.slice(0,5)}–${nextConflict2.endTime.slice(0,5)}) for this employee.` });
      }
    }
    const shift = await storage.updateShift(Number(req.params.id), partial.data);
    res.json(shift);
  });

  router.delete("/api/shifts/:id", requireRole("admin", "manager"), async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

  router.get("/api/steepin/employees", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const emps = await storage.getEmployees(ownerAccountId);
    // Use is_active for DB filter, but Drizzle might map it to isActive
    res.json(emps.filter(e => e.status === "active"));
  });

  router.get("/api/steepin/entries/:employeeId", async (req, res) => {
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

  router.get("/api/steepin/open-sessions", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const entries = await storage.getOpenSessionEntries(ownerAccountId);
    res.json(entries);
  });

  router.get("/api/steepin/entries", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
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
    const { employeeId, type, passcode, notes, reClockAction, skipReClockCheck } = req.body;
    if (!employeeId || !type || !passcode) {
      return res.status(400).json({ message: "Employee ID, action type, and passcode are required" });
    }

    const emp = await storage.getEmployee(Number(employeeId));
    if (!emp) return res.status(404).json({ message: "Employee not found" });

    if (emp.accessCode !== passcode) {
      return res.status(401).json({ message: "Invalid passcode" });
    }

    let date = format(new Date(), "yyyy-MM-dd");
    if (type !== "clock-in") {
      const openDate = await storage.getOpenSessionDate(Number(employeeId));
      if (openDate) date = openDate;
    }

    if (type === "clock-in" && !skipReClockCheck) {
      const lastClockOut = await storage.getLastClockOutForEmployee(Number(employeeId));
      if (lastClockOut) {
        const minutesSince = differenceInMinutes(new Date(), new Date(lastClockOut.timestamp));
        if (minutesSince < 35) {
          const todayStr = format(new Date(), "yyyy-MM-dd");
          const shiftsToday = await storage.getShiftsByEmployeeAndDate(Number(employeeId), todayStr);
          const now = new Date();
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          const hasNearbyShift = shiftsToday.some((s) => {
            const [h, m] = s.startTime.split(":").map(Number);
            return Math.abs(h * 60 + m - nowMinutes) <= 30;
          });

          if (!hasNearbyShift && !reClockAction) {
            return res.status(200).json({
              reClockDetected: true,
              lastClockOutTime: lastClockOut.timestamp,
              lastClockOutId: lastClockOut.id,
              lastClockOutDate: lastClockOut.date,
              minutesSince,
            });
          }

          if (reClockAction && reClockAction !== "new-shift") {
            await storage.deleteTimeEntry(lastClockOut.id);
            const clockOutDate = lastClockOut.date;

            if (reClockAction === "break") {
              await storage.createTimeEntryManual(Number(employeeId), "break-start", clockOutDate, new Date(lastClockOut.timestamp));
              await storage.createTimeEntryManual(Number(employeeId), "break-end", clockOutDate, new Date());
            }

            if (emp.ownerAccountId) {
              const approval = await storage.createApprovalRequest({
                employeeId: Number(employeeId),
                ownerAccountId: emp.ownerAccountId,
                type: "gap-classification",
                requestData: JSON.stringify({
                  action: reClockAction,
                  gapStartTime: lastClockOut.timestamp,
                  gapEndTime: new Date().toISOString(),
                  minutesGap: minutesSince,
                }),
                entryDate: clockOutDate,
              });

              const settings = await storage.getNotificationSettings(emp.ownerAccountId);
              if (settings.notifyApprovals) {
                await storage.createNotification({
                  accountId: emp.ownerAccountId,
                  type: "approval-needed",
                  title: "Gap Time Approval Needed",
                  message: `${emp.name} re-clocked in after ${minutesSince} min and requested "${reClockAction === 'break' ? 'count as break' : 'count as working time'}".`,
                  data: JSON.stringify({ approvalId: approval.id, employeeId: emp.id }),
                });
              }
            }

            return res.status(201).json({ reClockHandled: true, action: reClockAction });
          }
        }
      }
    }

    const entry = await storage.createTimeEntry(Number(employeeId), type, date, notes || null);

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
      if (type === "clock-in" && settings.notifyLate) {
        const todayStr = format(new Date(), "yyyy-MM-dd");
        const shiftsToday = await storage.getShiftsByEmployeeAndDate(Number(employeeId), todayStr);
        if (shiftsToday.length > 0) {
          const now = new Date();
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          for (const shift of shiftsToday) {
            const [h, m] = shift.startTime.split(":").map(Number);
            const shiftStartMinutes = h * 60 + m;
            if (nowMinutes > shiftStartMinutes + settings.lateThresholdMinutes) {
              await storage.createNotification({
                accountId: emp.ownerAccountId,
                type: "employee-late",
                title: "Late Clock-In",
                message: `${emp.name} clocked in ${nowMinutes - shiftStartMinutes} minutes after their scheduled shift start (${shift.startTime.slice(0, 5)}).`,
                data: JSON.stringify({ employeeId: emp.id, shiftId: shift.id }),
              });
              break;
            }
          }
        }
      }

      if (type === "clock-out" && settings.notifyEarlyClockOut) {
        const shiftsOnDate = await storage.getShiftsByEmployeeAndDate(Number(employeeId), date);
        if (shiftsOnDate.length > 0) {
          const now = new Date();
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          for (const shift of shiftsOnDate) {
            const [h, m] = shift.endTime.split(":").map(Number);
            const shiftEndMinutes = h * 60 + m;
            if (shiftEndMinutes > nowMinutes + settings.earlyClockOutThresholdMinutes) {
              await storage.createNotification({
                accountId: emp.ownerAccountId,
                type: "early-clock-out",
                title: "Early Clock-Out",
                message: `${emp.name} clocked out ${shiftEndMinutes - nowMinutes} minutes before their scheduled shift end (${shift.endTime.slice(0, 5)}).`,
                data: JSON.stringify({ employeeId: emp.id, shiftId: shift.id }),
              });
              break;
            }
          }
        }
      }
    }

    res.status(201).json(entry);
  });

  router.patch("/api/steepin/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    const id = parseInt(req.params.id);
    const updateData: any = {};
    if (req.body.timestamp) {
      updateData.timestamp = new Date(req.body.timestamp);
    }
    if (req.body.type) {
      updateData.type = req.body.type;
    }
    if (req.body.role !== undefined) {
      updateData.role = req.body.role;
    }
    if (req.body.isUnpaid !== undefined) {
      updateData.isUnpaid = Boolean(req.body.isUnpaid);
    }
    const entry = await storage.updateTimeEntry(id, updateData);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    res.json(entry);
  });

  router.post("/api/steepin/entries", requireRole("admin", "manager"), async (req, res) => {
    const { employeeId, type, date, timestamp, role, isUnpaid } = req.body;
    if (!employeeId || !type || !date) {
      return res.status(400).json({ message: "Employee ID, type, and date are required" });
    }
    const entry = await storage.createTimeEntryManual(Number(employeeId), type, date, timestamp ? new Date(timestamp) : new Date(), role || null, null, isUnpaid === true);
    res.status(201).json(entry);
  });

  router.delete("/api/steepin/entries", requireRole("admin", "manager"), async (req, res) => {
    const employeeId = Number(req.query.employeeId);
    const date = req.query.date as string;
    if (!employeeId || !date) {
      return res.status(400).json({ message: "Employee ID and date are required" });
    }
    const emp = await storage.getEmployee(employeeId);
    if (!emp || emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    await storage.deleteTimeEntriesByEmployeeAndDate(employeeId, date);
    res.status(204).send();
  });

  router.delete("/api/steepin/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    await storage.deleteTimeEntry(Number(req.params.id));
    res.status(204).send();
  });

  router.post("/api/steepin/entries/delete-batch", requireRole("admin", "manager"), async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No IDs provided" });
    }
    await storage.batchDeleteTimeEntriesByIds(ids.map(Number), req.session.userId!);
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
    const [account, employees, roles, breakPolicy, notificationCount] = await Promise.all([
      storage.getAccount(accountId),
      storage.getEmployees(accountId),
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
    const isSteepIn = req.session.steepinMode ?? false;
    const response: any = {
      auth: {
        authenticated: true,
        user: authUser,
        employee: null,
        steepinMode: isSteepIn,
      },
      employees,
      roles,
      breakPolicy,
      notificationCount,
    };
    if (isSteepIn) {
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const activeEmps = employees.filter((e: any) => e.status === "active");
      const entryResults = await Promise.all(
        activeEmps.map(async (emp: any) => {
          let entries = await storage.getTimeEntriesByEmployeeAndDate(emp.id, todayStr);
          const lastType = entries.length > 0 ? entries[entries.length - 1].type : null;
          const hasOpenSession = lastType === "clock-in" || lastType === "break-start" || lastType === "break-end";
          if (!hasOpenSession) {
            const openDate = await storage.getOpenSessionDate(emp.id);
            if (openDate && openDate !== todayStr) {
              entries = await storage.getTimeEntriesByEmployeeAndDate(emp.id, openDate);
            }
          }
          return { employeeId: emp.id, entries };
        })
      );
      response.steepinEntries = Object.fromEntries(
        entryResults.map((r) => [r.employeeId.toString(), r.entries])
      );
    }
    res.json(response);
  });

  app.use(router);

  return httpServer;
}
