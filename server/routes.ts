import type { Express } from "express";
import { createServer, type Server } from "http";
import { Router } from "express";
import { storage } from "./storage";
import { insertEmployeeSchema, insertShiftSchema, breakPolicySchema } from "@shared/schema";
import { setupSession, registerAuthRoutes, requireAuth, requireRole } from "./auth";
import { format } from "date-fns";

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

  router.get("/api/kiosk/entries/:employeeId", async (req, res) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const entries = await storage.getTimeEntriesByEmployeeAndDate(Number(req.params.employeeId), todayStr);
    res.json(entries);
  });

  router.get("/api/kiosk/entries", requireAuth, async (req, res) => {
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

  router.delete("/api/kiosk/entries", requireRole("admin", "manager"), async (req, res) => {
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

  router.delete("/api/kiosk/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    // Note: The existing storage doesn't have a single entry delete yet, 
    // but the user wants to delete timesheets (sessions).
    // For now, the existing delete handles the whole day.
    // To support deleting just one session, we'd need a storage.deleteTimeEntry(id).
    // Let's add it.
    await storage.deleteTimeEntry(Number(req.params.id));
    res.status(204).send();
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
    if (existing.length >= 6) {
      return res.status(400).json({ message: "Maximum of 6 roles allowed" });
    }
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
    const duplicate = existing.find((r) => r.name.toLowerCase() === name.trim().toLowerCase() && r.id !== Number(req.params.id));
    if (duplicate) {
      return res.status(400).json({ message: "A role with this name already exists" });
    }
    const role = await storage.updateCustomRole(Number(req.params.id), name.trim(), color);
    if (!role) return res.status(404).json({ message: "Role not found" });
    res.json(role);
  });

  router.delete("/api/roles/:id", requireRole("admin", "manager"), async (req, res) => {
    await storage.deleteCustomRole(Number(req.params.id));
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

  app.use(router);

  return httpServer;
}
