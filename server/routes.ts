import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertEmployeeSchema, insertShiftSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // === EMPLOYEES ===
  app.get("/api/employees", async (_req, res) => {
    const employees = await storage.getEmployees();
    res.json(employees);
  });

  app.get("/api/employees/:id", async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.post("/api/employees", async (req, res) => {
    const parsed = insertEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const emp = await storage.createEmployee(parsed.data);
    res.status(201).json(emp);
  });

  app.patch("/api/employees/:id", async (req, res) => {
    const partial = insertEmployeeSchema.partial().safeParse(req.body);
    if (!partial.success) {
      return res.status(400).json({ message: partial.error.issues[0].message });
    }
    const emp = await storage.updateEmployee(Number(req.params.id), partial.data);
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.delete("/api/employees/:id", async (req, res) => {
    await storage.deleteEmployee(Number(req.params.id));
    res.status(204).send();
  });

  // === SHIFTS ===
  app.get("/api/shifts", async (_req, res) => {
    const allShifts = await storage.getShifts();
    res.json(allShifts);
  });

  app.get("/api/shifts/:id", async (req, res) => {
    const shift = await storage.getShift(Number(req.params.id));
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    res.json(shift);
  });

  app.post("/api/shifts", async (req, res) => {
    const parsed = insertShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const shift = await storage.createShift(parsed.data);
    res.status(201).json(shift);
  });

  app.patch("/api/shifts/:id", async (req, res) => {
    const partial = insertShiftSchema.partial().safeParse(req.body);
    if (!partial.success) {
      return res.status(400).json({ message: partial.error.issues[0].message });
    }
    const shift = await storage.updateShift(Number(req.params.id), partial.data);
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    res.json(shift);
  });

  app.delete("/api/shifts/:id", async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

  return httpServer;
}
