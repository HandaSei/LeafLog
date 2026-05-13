import type { Router } from "express";
import { insertEmployeeSchema } from "@shared/schema";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";
import { broadcastManagerUpdate } from "../sse";
import {
  assertCanSetEmployeeBreakException,
  assertCanDeactivateRinseEmployee,
  getRinseEmployeeActivationPatch,
  RinseEmployeeLimitError,
  RinseFeatureLimitError,
  sanitizeEmployeeForRinseBreakPolicy,
  sanitizeEmployeesForRinseBreakPolicy,
  sendRinseFeatureLimitError,
  sendRinseLimitError,
} from "../services/subscription-limits";

export function registerEmployeeRoutes(router: Router) {
  // === EMPLOYEES ===
  router.get("/api/employees", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const emps = await storage.getEmployees(ownerAccountId);
    res.json(await sanitizeEmployeesForRinseBreakPolicy(ownerAccountId, emps));
  });

  router.get("/api/employees/:id", requireAuth, async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    if (emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    res.json(await sanitizeEmployeeForRinseBreakPolicy(req.session.userId!, emp));
  });

  router.post("/api/employees", requireRole("admin", "manager"), async (req, res) => {
    const parsed = insertEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const ownerAccountId = req.session.userId!;
    const willBeActive = (parsed.data.status ?? "active") === "active" && parsed.data.hiddenFromSteepin !== true;
    let subscriptionPendingSince: Date | null | undefined;

    try {
      await assertCanSetEmployeeBreakException(
        ownerAccountId,
        parsed.data.paidBreakMinutes,
        parsed.data.maxBreakMinutes,
      );

      if (willBeActive) {
        const activation = await getRinseEmployeeActivationPatch(ownerAccountId);
        subscriptionPendingSince = activation.subscriptionPendingSince;
      }
    } catch (error) {
      if (error instanceof RinseEmployeeLimitError) {
        return sendRinseLimitError(res, error);
      }
      if (error instanceof RinseFeatureLimitError) {
        return sendRinseFeatureLimitError(res, error);
      }
      throw error;
    }

    const emp = await storage.createEmployee({
      ...parsed.data,
      ownerAccountId,
      archivedAt: null,
      subscriptionPendingSince,
    });
    broadcastManagerUpdate(req.session.userId!, {
      type: "employees-changed",
      employeeId: emp.id,
      source: "manager",
    });
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
    const ownerAccountId = req.session.userId!;
    const nextStatus = partial.data.status ?? emp.status;
    const nextHiddenFromSteepin = partial.data.hiddenFromSteepin ?? emp.hiddenFromSteepin;
    const wasActive = emp.status === "active" && emp.hiddenFromSteepin !== true;
    const willBeActive = nextStatus === "active" && nextHiddenFromSteepin !== true;
    const patch: Parameters<typeof storage.updateEmployee>[1] = { ...partial.data };

    try {
      await assertCanSetEmployeeBreakException(
        ownerAccountId,
        partial.data.paidBreakMinutes,
        partial.data.maxBreakMinutes,
      );

      if (wasActive && !willBeActive) {
        await assertCanDeactivateRinseEmployee(ownerAccountId, emp);
      }

      if (!wasActive && willBeActive) {
        const activation = await getRinseEmployeeActivationPatch(ownerAccountId, emp);
        patch.subscriptionPendingSince = activation.subscriptionPendingSince;
      }
    } catch (error) {
      if (error instanceof RinseEmployeeLimitError) {
        return sendRinseLimitError(res, error);
      }
      if (error instanceof RinseFeatureLimitError) {
        return sendRinseFeatureLimitError(res, error);
      }
      throw error;
    }

    if (partial.data.hiddenFromSteepin === true) {
      patch.archivedAt = new Date();
    } else if (partial.data.hiddenFromSteepin === false) {
      patch.archivedAt = null;
    }

    const updated = await storage.updateEmployee(Number(req.params.id), patch);
    broadcastManagerUpdate(req.session.userId!, {
      type: "employees-changed",
      employeeId: Number(req.params.id),
      source: "manager",
    });
    res.json(updated);
  });

  router.delete("/api/employees/:id", requireRole("admin", "manager"), async (req, res) => {
    const emp = await storage.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    if (emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    await storage.deleteEmployee(Number(req.params.id));
    broadcastManagerUpdate(req.session.userId!, {
      type: "employees-changed",
      employeeId: Number(req.params.id),
      source: "manager",
    });
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
    broadcastManagerUpdate(req.session.userId!, {
      type: "shifts-changed",
      employeeId: Number(req.params.id),
      source: "manager",
    });
    res.json({ updated: true });
  });
}
