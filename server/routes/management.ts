import type { Router } from "express";
import bcrypt from "bcryptjs";
import { format, parseISO, subDays } from "date-fns";
import { adminGiftSubscriptionSchema, breakPolicySchema, notificationSettingsSchema, type Account } from "@shared/schema";
import { computeEffectiveSubscription } from "@shared/subscription";
import { requireAuth, requireRole } from "../auth";
import { pool, storage } from "../storage";
import { DATE_ONLY_RE, type RecentEntryRow } from "./utils";
import { addManagerSSEClient, removeManagerSSEClient } from "../sse";
import {
  assertCanAddCustomRoles,
  assertCanCreateManualTimesheetBackup,
  assertCanSetEmployeeBreakException,
  assertCanUseTimesheetBackup,
  getRinseEmployeeLimitState,
  getVisibleBackupsForSubscription,
  registerKioskDeviceForSubscription,
  RinseFeatureLimitError,
  sanitizeEmployeesForRinseBreakPolicy,
  sendRinseFeatureLimitError,
} from "../services/subscription-limits";
import { ensureTrialExpiredRawNotice } from "../services/subscription-notices";

function subscriptionSnapshotFromAccount(account: Pick<
  Account,
  | "role"
  | "subscriptionTier"
  | "subscriptionStatus"
  | "subscriptionTrialEndsAt"
  | "subscriptionGiftExpiresAt"
  | "subscriptionUpdatedAt"
>) {
  if (account.role === "admin") {
    return null;
  }
  return computeEffectiveSubscription({
    tier: account.subscriptionTier,
    status: account.subscriptionStatus,
    trialEndsAt: account.subscriptionTrialEndsAt,
    giftExpiresAt: account.subscriptionGiftExpiresAt,
    updatedAt: account.subscriptionUpdatedAt,
  });
}

function parseGiftExpiresAt(value: string | null | undefined) {
  if (!value) return null;
  if (!DATE_ONLY_RE.test(value)) {
    throw new Error("Gift expiry must be a date in yyyy-MM-dd format");
  }
  const expiresAt = new Date(`${value}T23:59:59.999`);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Gift expiry date is invalid");
  }
  return expiresAt;
}

export function registerManagementRoutes(router: Router) {
  // === TIMESHEET BACKUPS ===
  router.get("/api/backups", requireRole("admin", "manager"), async (req, res) => {
    try {
      const backups = await storage.getTimesheetBackups(req.session.userId!);
      res.json(await getVisibleBackupsForSubscription(req.session.userId!, backups));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  router.post("/api/backups", requireRole("admin", "manager"), async (req, res) => {
    try {
      await assertCanCreateManualTimesheetBackup(req.session.userId!);
      const backup = await storage.createTimesheetBackup(req.session.userId!, "Manual backup");
      res.json({ id: backup.id, label: backup.label, entryCount: backup.entryCount, createdAt: backup.createdAt });
    } catch (err: any) {
      if (err instanceof RinseFeatureLimitError) {
        return sendRinseFeatureLimitError(res, err);
      }
      res.status(500).json({ message: err.message });
    }
  });

  router.post("/api/backups/:id/restore", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid backup id" });
      await assertCanUseTimesheetBackup(req.session.userId!, id);
      const restored = await storage.restoreTimesheetBackup(id, req.session.userId!);
      res.json({ restored });
    } catch (err: any) {
      if (err instanceof RinseFeatureLimitError) {
        return sendRinseFeatureLimitError(res, err);
      }
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
    try {
      await assertCanAddCustomRoles(req.session.userId!, [name.trim()]);
    } catch (err) {
      if (err instanceof RinseFeatureLimitError) {
        return sendRinseFeatureLimitError(res, err);
      }
      throw err;
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
    try {
      await assertCanSetEmployeeBreakException(
        req.session.userId!,
        parsed.data.paidBreakMinutes,
        parsed.data.maxBreakMinutes,
      );
    } catch (err) {
      if (err instanceof RinseFeatureLimitError) {
        return sendRinseFeatureLimitError(res, err);
      }
      throw err;
    }
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

  // === SUBSCRIPTION ===
  router.get("/api/subscription", requireAuth, async (req, res) => {
    const account = await storage.getAccount(req.session.userId!);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.role === "admin") return res.json({ adminExempt: true });
    await ensureTrialExpiredRawNotice(account);
    res.json(subscriptionSnapshotFromAccount(account));
  });

  router.get("/api/subscription/rinse-employee-limit", requireRole("admin", "manager"), async (req, res) => {
    res.json(await getRinseEmployeeLimitState(req.session.userId!));
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

  router.get("/api/manager/stream", requireRole("admin", "manager"), (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ accountId: req.session.userId })}\n\n`);

    const client = addManagerSSEClient(req.session.userId!, res);
    req.on("close", () => {
      removeManagerSSEClient(client);
    });
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

    // Start independent bootstrap queries early. Manager dashboard data begins as
    // soon as the account role is known; SteepIn recent entries begin as soon as
    // employee IDs are known.
    const accountPromise = storage.getAccount(accountId);
    const employeesPromise = storage.getEmployees(accountId);
    const dashboardPromise = accountPromise.then(async (account) => {
      if (!account || isSteepInSession || (account.role !== "admin" && account.role !== "manager")) {
        return null;
      }
      const [dashboardShifts, dashboardEntries, dashboardOpenSessionEntries] = await Promise.all([
        storage.getShiftsByDateRange(accountId, dashboardYesterday, dashboardToday),
        storage.getTimeEntriesByDate(dashboardToday, accountId),
        storage.getOpenSessionEntries(accountId),
      ]);
      return {
        today: dashboardToday,
        yesterday: dashboardYesterday,
        shifts: dashboardShifts,
        entries: dashboardEntries,
        openSessionEntries: dashboardOpenSessionEntries,
      };
    });
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

    const [account, employees, roles, breakPolicy, notificationCount, dashboardData] = await Promise.all([
      accountPromise,
      employeesPromise,
      storage.getCustomRoles(accountId),
      storage.getBreakPolicy(accountId),
      storage.getUnreadNotificationCount(accountId),
      dashboardPromise,
    ]);
    if (!account) {
      return res.json({ auth: { authenticated: false } });
    }
    const createdSubscriptionNotice = await ensureTrialExpiredRawNotice(account);
    const finalNotificationCount = createdSubscriptionNotice
      ? await storage.getUnreadNotificationCount(accountId)
      : notificationCount;
    const authUser = {
      id: account.id,
      username: account.username,
      role: account.role,
      employeeId: account.employeeId ?? null,
      agencyName: account.agencyName ?? null,
      email: account.email ?? null,
    };
    const isSteepIn = isSteepInSession;
    const employeesForResponse = await sanitizeEmployeesForRinseBreakPolicy(accountId, employees);
    const steepinEmployees = isSteepIn
      ? employeesForResponse.filter((e: any) => e.status === "active" && !e.hiddenFromSteepin)
      : employeesForResponse;
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
      notificationCount: finalNotificationCount,
    };
    response.steepinThemeSettings = {
      mode: account.steepinThemeMode || "light",
      dayStartHour: account.steepinDayStartHour ?? 7,
      nightStartHour: account.steepinNightStartHour ?? 19,
    };

    if (dashboardData) {
      response.dashboard = dashboardData;
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
    try {
      const device = await registerKioskDeviceForSubscription(ownerAccountId, deviceId, name);
      return res.json(device);
    } catch (err) {
      if (err instanceof RinseFeatureLimitError) {
        return sendRinseFeatureLimitError(res, err);
      }
      throw err;
    }
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
    res.json(allAccounts.map((account) => ({
      ...account,
      subscription: subscriptionSnapshotFromAccount(account),
    })));
  });

  router.patch("/api/admin/accounts/:id/subscription-gift", requireRole("admin"), async (req, res) => {
    const accountId = Number(req.params.id);
    if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account id" });

    const parsed = adminGiftSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

    const existingAccount = await storage.getAccount(accountId);
    if (!existingAccount) return res.status(404).json({ message: "Account not found" });
    if (existingAccount.role === "admin") {
      return res.status(400).json({ message: "Admin accounts do not need a subscription plan" });
    }

    let expiresAt: Date | null;
    try {
      expiresAt = parseGiftExpiresAt(parsed.data.expiresAt);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }

    const account = await storage.updateAccount(accountId, {
      subscriptionTier: parsed.data.tier,
      subscriptionStatus: "gifted",
      subscriptionTrialEndsAt: null,
      subscriptionGiftExpiresAt: expiresAt,
      subscriptionUpdatedAt: new Date(),
    });
    if (!account) return res.status(404).json({ message: "Account not found" });

    res.json({
      id: account.id,
      username: account.username,
      agencyName: account.agencyName,
      email: account.email,
      role: account.role,
      createdAt: account.createdAt,
      subscriptionTier: account.subscriptionTier,
      subscriptionStatus: account.subscriptionStatus,
      subscriptionTrialEndsAt: account.subscriptionTrialEndsAt,
      subscriptionGiftExpiresAt: account.subscriptionGiftExpiresAt,
      subscriptionUpdatedAt: account.subscriptionUpdatedAt,
      subscription: subscriptionSnapshotFromAccount(account),
    });
  });
}
