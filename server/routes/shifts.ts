import type { Router } from "express";
import { addDays, format, parseISO, subDays } from "date-fns";
import { insertShiftSchema } from "@shared/schema";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";
import { getDateRangeQuery, toDateOnly } from "./utils";
import { broadcastManagerUpdate } from "../sse";

export function registerShiftRoutes(router: Router) {
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
    broadcastManagerUpdate(req.session.userId!, {
      type: "shifts-changed",
      employeeId: shift.employeeId,
      date: toDateOnly(shift.date),
      shiftId: shift.id,
      source: "manager",
    });
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
    if (shift) {
      broadcastManagerUpdate(req.session.userId!, {
        type: "shifts-changed",
        employeeId: shift.employeeId,
        date: toDateOnly(shift.date),
        shiftId: shift.id,
        source: "manager",
      });
    }
    res.json(shift);
  });

  router.delete("/api/shifts/:id", requireRole("admin", "manager"), async (req, res) => {
    const existing = await storage.getShift(Number(req.params.id));
    await storage.deleteShift(Number(req.params.id));
    if (existing) {
      broadcastManagerUpdate(req.session.userId!, {
        type: "shifts-changed",
        employeeId: existing.employeeId,
        date: toDateOnly(existing.date),
        shiftId: existing.id,
        source: "manager",
      });
    }
    res.status(204).send();
  });
}
