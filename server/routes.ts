import type { Express } from "express";
import { createServer, type Server } from "http";
import { Router } from "express";
import { storage } from "./storage";
import { insertEmployeeSchema, insertShiftSchema } from "@shared/schema";
import { setupSession, registerAuthRoutes, requireAuth, requireRole } from "./auth";
import { format } from "date-fns";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupSession(app);

  const router = Router();
  registerAuthRoutes(router);

  // === EMPLOYEES ===
  router.get("/api/employees", requireAuth, async (_req, res) => {
    const employees = await storage.getEmployees();
    res.json(employees);
  });

  router.get("/api/employees/:id", requireAuth, async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  router.post("/api/employees", requireRole("admin", "manager"), async (req, res) => {
    const parsed = insertEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const emp = await storage.createEmployee(parsed.data);
    res.status(201).json(emp);
  });

  router.patch("/api/employees/:id", requireRole("admin", "manager"), async (req, res) => {
    const partial = insertEmployeeSchema.partial().safeParse(req.body);
    if (!partial.success) {
      return res.status(400).json({ message: partial.error.issues[0].message });
    }
    const emp = await storage.updateEmployee(Number(req.params.id), partial.data);
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  router.delete("/api/employees/:id", requireRole("admin", "manager"), async (req, res) => {
    await storage.deleteEmployee(Number(req.params.id));
    res.status(204).send();
  });

  // === SHIFTS ===
  router.get("/api/shifts", requireAuth, async (_req, res) => {
    const allShifts = await storage.getShifts();
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
    const shift = await storage.createShift(parsed.data);
    res.status(201).json(shift);
  });

  router.patch("/api/shifts/:id", requireRole("admin", "manager"), async (req, res) => {
    const partial = insertShiftSchema.partial().safeParse(req.body);
    if (!partial.success) {
      return res.status(400).json({ message: partial.error.issues[0].message });
    }
    const shift = await storage.updateShift(Number(req.params.id), partial.data);
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    res.json(shift);
  });

  router.delete("/api/shifts/:id", requireRole("admin", "manager"), async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

  router.get("/api/kiosk/entries", requireAuth, async (req, res) => {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;

    if (employeeId && date) {
      const entries = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      return res.json(entries);
    } else if (date) {
      const entries = await storage.getTimeEntriesByDate(date);
      return res.json(entries);
    }

    const entries = await storage.getAllTimeEntries();
    res.json(entries);
  });

  router.post("/api/kiosk/action", async (req, res) => {
    const { employeeId, type, passcode } = req.body;
    if (!employeeId || !type || !passcode) {
      return res.status(400).json({ message: "Employee ID, action type, and passcode are required" });
    }

    const emp = await storage.getEmployee(Number(employeeId));
    if (!emp) return res.status(404).json({ message: "Employee not found" });

    if (emp.accessCode !== passcode) {
      return res.status(401).json({ message: "Invalid passcode" });
    }

    const date = format(new Date(), "yyyy-MM-dd");
    const entry = await storage.createTimeEntry(Number(employeeId), type, date);
    res.status(201).json(entry);
  });

  router.patch("/api/kiosk/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    const id = parseInt(req.params.id);
    const updateData: any = {};
    if (req.body.timestamp) {
      updateData.timestamp = new Date(req.body.timestamp);
    }
    if (req.body.type) {
      updateData.type = req.body.type;
    }
    const entry = await storage.updateTimeEntry(id, updateData);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    res.json(entry);
  });

  router.post("/api/kiosk/entries", requireRole("admin", "manager"), async (req, res) => {
    const { employeeId, type, date, timestamp } = req.body;
    if (!employeeId || !type || !date) {
      return res.status(400).json({ message: "Employee ID, type, and date are required" });
    }
    const entry = await storage.createTimeEntryManual(Number(employeeId), type, date, timestamp ? new Date(timestamp) : new Date());
    res.status(201).json(entry);
  });

  app.use(router);

  return httpServer;
}
