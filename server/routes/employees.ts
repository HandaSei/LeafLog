import type { Router } from "express";
import { insertEmployeeSchema } from "@shared/schema";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";

export function registerEmployeeRoutes(router: Router) {
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
    const emp = await storage.createEmployee({ ...parsed.data, ownerAccountId: req.session.userId! });
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
}
