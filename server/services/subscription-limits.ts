import type { Account, Employee, KioskDevice } from "@shared/schema";
import { format, subDays } from "date-fns";
import {
  addDays,
  computeEffectiveSubscription,
  getRinseBillingPeriod,
  getRinseProration,
  RINSE_EMPLOYEE_LIMIT,
  RINSE_PLAN_LIMITS,
  type RinseEmployeeLimitBlockCode,
  type RinseEmployeeLimitState,
} from "@shared/subscription";
import { pool, storage } from "../storage";

export const RINSE_IMPORT_BACKUP_LABEL = "Before CSV Import";

export class RinseEmployeeLimitError extends Error {
  status: number;
  code: RinseEmployeeLimitBlockCode;
  details: RinseEmployeeLimitState;

  constructor(status: number, code: RinseEmployeeLimitBlockCode, message: string, details: RinseEmployeeLimitState) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type RinseFeatureLimitCode =
  | "RINSE_TIMESHEET_HISTORY_LIMIT"
  | "RINSE_BREAK_EXCEPTION_LIMIT"
  | "RINSE_ROLE_LIMIT"
  | "RINSE_MANUAL_BACKUP_LIMIT"
  | "RINSE_DEVICE_LIMIT";

export class RinseFeatureLimitError extends Error {
  status: number;
  code: RinseFeatureLimitCode;

  constructor(status: number, code: RinseFeatureLimitCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class PaidFeatureLimitError extends Error {
  status: number;
  code = "PAID_PLAN_REQUIRED" as const;

  constructor(message: string) {
    super(message);
    this.status = 403;
  }
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function roundMoney(value: number) {
  return Math.round(value * 1000) / 1000;
}

function isEmployeeActive(employee: Pick<Employee, "status" | "hiddenFromSteepin">) {
  return employee.status === "active" && employee.hiddenFromSteepin !== true;
}

function getPeriodAnchor(account: Account, now: Date) {
  return toDate(account.subscriptionUpdatedAt) ?? toDate(account.createdAt) ?? now;
}

export function isRinseAccount(account: Account, now = new Date()) {
  const subscription = computeEffectiveSubscription({
    tier: account.subscriptionTier,
    status: account.subscriptionStatus,
    trialEndsAt: account.subscriptionTrialEndsAt,
    giftExpiresAt: account.subscriptionGiftExpiresAt,
    updatedAt: account.subscriptionUpdatedAt,
  }, now);

  return subscription.effectiveTier === "rinse";
}

export function canUsePaidPlanFeatures(account: Account, now = new Date()) {
  if (account.role === "admin") {
    return true;
  }
  const subscription = computeEffectiveSubscription({
    tier: account.subscriptionTier,
    status: account.subscriptionStatus,
    trialEndsAt: account.subscriptionTrialEndsAt,
    giftExpiresAt: account.subscriptionGiftExpiresAt,
    updatedAt: account.subscriptionUpdatedAt,
  }, now);

  return subscription.effectiveTier !== "raw";
}

export async function canUsePaidPlanFeaturesByAccountId(accountId: number, now = new Date()) {
  const account = await storage.getAccount(accountId);
  return !!account && canUsePaidPlanFeatures(account, now);
}

export async function assertCanUsePaidPlanFeature(accountId: number, featureName: string, now = new Date()) {
  if (await canUsePaidPlanFeaturesByAccountId(accountId, now)) {
    return;
  }
  throw new PaidFeatureLimitError(`${featureName} is available on paid plans only.`);
}

export async function isRinseAccountId(ownerAccountId: number, now = new Date()) {
  const account = await storage.getAccount(ownerAccountId);
  return !!account && isRinseAccount(account, now);
}

export function getRinseHistoryCutoffDate(now = new Date()) {
  return format(subDays(now, RINSE_PLAN_LIMITS.timesheetHistoryDays), "yyyy-MM-dd");
}

export async function getRinseTimesheetHistoryCutoff(ownerAccountId: number, now = new Date()) {
  return await isRinseAccountId(ownerAccountId, now) ? getRinseHistoryCutoffDate(now) : null;
}

export async function getRinseLimitedDateRange(ownerAccountId: number, from: string, to: string, now = new Date()) {
  const cutoff = await getRinseTimesheetHistoryCutoff(ownerAccountId, now);
  if (!cutoff) {
    return { from, to, cutoff: null, empty: false };
  }
  if (to < cutoff) {
    return { from: cutoff, to, cutoff, empty: true };
  }
  return { from: from < cutoff ? cutoff : from, to, cutoff, empty: false };
}

export async function isBlockedByRinseTimesheetHistory(ownerAccountId: number, date: string, now = new Date()) {
  const cutoff = await getRinseTimesheetHistoryCutoff(ownerAccountId, now);
  return !!cutoff && date < cutoff;
}

export async function sanitizeEmployeesForRinseBreakPolicy<T extends { paidBreakMinutes?: number | null; maxBreakMinutes?: number | null }>(
  ownerAccountId: number,
  employees: T[],
) {
  if (!(await isRinseAccountId(ownerAccountId))) {
    return employees;
  }
  return employees.map((employee) => ({
    ...employee,
    paidBreakMinutes: null,
    maxBreakMinutes: null,
  }));
}

export async function sanitizeEmployeeForRinseBreakPolicy<T extends { paidBreakMinutes?: number | null; maxBreakMinutes?: number | null }>(
  ownerAccountId: number,
  employee: T,
) {
  const [sanitized] = await sanitizeEmployeesForRinseBreakPolicy(ownerAccountId, [employee]);
  return sanitized;
}

export async function assertCanSetEmployeeBreakException(ownerAccountId: number, paidBreakMinutes?: number | null, maxBreakMinutes?: number | null) {
  if (paidBreakMinutes == null && maxBreakMinutes == null) {
    return;
  }
  if (await isRinseAccountId(ownerAccountId)) {
    throw new RinseFeatureLimitError(
      403,
      "RINSE_BREAK_EXCEPTION_LIMIT",
      "Rinse uses the general break policy only. Per-employee break exceptions are available on higher tiers.",
    );
  }
}

export async function assertCanCreateManualTimesheetBackup(ownerAccountId: number) {
  if (await isRinseAccountId(ownerAccountId)) {
    throw new RinseFeatureLimitError(
      403,
      "RINSE_MANUAL_BACKUP_LIMIT",
      "Rinse does not include manual timesheet backups. A backup is still created automatically before CSV imports.",
    );
  }
}

export async function assertCanRegisterKioskDevice(ownerAccountId: number, deviceId: string) {
  if (!(await isRinseAccountId(ownerAccountId))) {
    return;
  }
  const devices = await storage.getKioskDevices(ownerAccountId);
  if (devices.some((device) => device.deviceId === deviceId)) {
    return;
  }
  if (devices.length >= RINSE_PLAN_LIMITS.maxKioskDevices) {
    throw new RinseFeatureLimitError(
      409,
      "RINSE_DEVICE_LIMIT",
      "Rinse supports one SteepIn device at a time. Exit SteepIn on the current device or delete it from Location Management before adding another.",
    );
  }
}

export async function registerKioskDeviceForSubscription(ownerAccountId: number, deviceId: string, deviceName: string): Promise<KioskDevice> {
  if (!(await isRinseAccountId(ownerAccountId))) {
    return storage.registerKioskDevice(ownerAccountId, deviceId, deviceName);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(726901, $1::int)", [ownerAccountId]);

    const existing = await client.query<{ id: number }>(
      "SELECT id FROM kiosk_devices WHERE owner_account_id = $1 AND device_id = $2",
      [ownerAccountId, deviceId],
    );

    if (existing.rows.length > 0) {
      const result = await client.query<KioskDevice>(
        `UPDATE kiosk_devices SET device_name = $1, last_seen = NOW() WHERE id = $2
         RETURNING id, owner_account_id as "ownerAccountId", device_id as "deviceId", device_name as "deviceName", is_locked as "isLocked", last_seen as "lastSeen"`,
        [deviceName, existing.rows[0].id],
      );
      await client.query("COMMIT");
      return result.rows[0];
    }

    const count = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int as count FROM kiosk_devices WHERE owner_account_id = $1",
      [ownerAccountId],
    );
    if ((count.rows[0]?.count ?? 0) >= RINSE_PLAN_LIMITS.maxKioskDevices) {
      throw new RinseFeatureLimitError(
        409,
        "RINSE_DEVICE_LIMIT",
        "Rinse supports one SteepIn device at a time. Exit SteepIn on the current device or delete it from Location Management before adding another.",
      );
    }

    const result = await client.query<KioskDevice>(
      `INSERT INTO kiosk_devices (owner_account_id, device_id, device_name, is_locked, last_seen)
       VALUES ($1, $2, $3, false, NOW())
       RETURNING id, owner_account_id as "ownerAccountId", device_id as "deviceId", device_name as "deviceName", is_locked as "isLocked", last_seen as "lastSeen"`,
      [ownerAccountId, deviceId, deviceName],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function assertCanAddCustomRoles(ownerAccountId: number, incomingNames: string[] = []) {
  if (!(await isRinseAccountId(ownerAccountId))) {
    return;
  }
  const existing = await storage.getCustomRoles(ownerAccountId);
  const existingNames = new Set(existing.map((role) => role.name.trim().toLowerCase()));
  const uniqueIncomingNames = new Set(
    incomingNames
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => name.toLowerCase())
      .filter((name) => !existingNames.has(name)),
  );
  if (existing.length + uniqueIncomingNames.size > RINSE_PLAN_LIMITS.maxCustomRoles) {
    throw new RinseFeatureLimitError(
      403,
      "RINSE_ROLE_LIMIT",
      `Rinse supports up to ${RINSE_PLAN_LIMITS.maxCustomRoles} custom roles. Delete an unused role or move to a higher tier before adding another one.`,
    );
  }
}

export async function getVisibleBackupsForSubscription<T extends { id: number; label: string }>(
  ownerAccountId: number,
  backups: T[],
) {
  if (!(await isRinseAccountId(ownerAccountId))) {
    return backups;
  }
  return backups
    .filter((backup) => backup.label === RINSE_IMPORT_BACKUP_LABEL)
    .slice(0, RINSE_PLAN_LIMITS.retainedImportBackups);
}

export async function assertCanUseTimesheetBackup(ownerAccountId: number, backupId: number) {
  const backups = await storage.getTimesheetBackups(ownerAccountId);
  const visibleBackups = await getVisibleBackupsForSubscription(ownerAccountId, backups);
  if (!backups.some((backup) => backup.id === backupId)) {
    throw new RinseFeatureLimitError(404, "RINSE_MANUAL_BACKUP_LIMIT", "Backup not found");
  }
  if (!visibleBackups.some((backup) => backup.id === backupId)) {
    throw new RinseFeatureLimitError(
      403,
      "RINSE_MANUAL_BACKUP_LIMIT",
      "Rinse can restore only the latest automatic CSV-import backup.",
    );
  }
}

export async function pruneRinseBackupsAfterImport(ownerAccountId: number, keepBackupId: number) {
  if (!(await isRinseAccountId(ownerAccountId))) {
    return;
  }
  const backups = await storage.getTimesheetBackups(ownerAccountId);
  await Promise.all(
    backups
      .filter((backup) => backup.id !== keepBackupId)
      .map((backup) => storage.deleteTimesheetBackup(backup.id, ownerAccountId)),
  );
}

function isPendingInCurrentPeriod(employee: Employee, periodStart: Date) {
  const pendingSince = toDate(employee.subscriptionPendingSince);
  return !!pendingSince && pendingSince.getTime() > periodStart.getTime();
}

function wasPaidForCurrentPeriod(employee: Employee, periodStart: Date) {
  const archivedAt = toDate(employee.archivedAt);
  return !isPendingInCurrentPeriod(employee, periodStart)
    && !!archivedAt
    && archivedAt.getTime() > periodStart.getTime();
}

function getPendingCredit(employees: Employee[], periodStart: Date, nextRenewalAt: Date) {
  return roundMoney(
    employees.reduce((total, employee) => {
      if (!isEmployeeActive(employee) || !isPendingInCurrentPeriod(employee, periodStart)) {
        return total;
      }
      const pendingSince = toDate(employee.subscriptionPendingSince);
      if (!pendingSince) return total;
      return total + getRinseProration(pendingSince, nextRenewalAt).amount;
    }, 0),
  );
}

function getBlockMessage(code: RinseEmployeeLimitBlockCode) {
  switch (code) {
    case "RINSE_ACTIVE_EMPLOYEE_LIMIT":
      return "Rinse supports up to 30 active employees. Archive or delete another employee before adding/reactivating this one, or move to a higher tier.";
    case "RINSE_PRORATE_PAYMENT_REQUIRED":
      return "Rinse allows up to 8 EUR of unpaid prorated employee additions in a billing period. Take payment before adding or reactivating another employee.";
    case "RINSE_PENDING_EMPLOYEE_DELETE_REQUIRED":
      return "This employee was added or reactivated during the current subscription period. Archiving becomes available after the first renewal; delete the employee if you need to stop billing before then.";
  }
}

export async function getRinseEmployeeLimitState(ownerAccountId: number, now = new Date()): Promise<RinseEmployeeLimitState> {
  const account = await storage.getAccount(ownerAccountId);
  const employees = await storage.getEmployees(ownerAccountId);
  const activeEmployeeCount = employees.filter(isEmployeeActive).length;
  const monthlyPriceEur = RINSE_EMPLOYEE_LIMIT.monthlyPriceEur;
  const dailyRateEur = monthlyPriceEur / RINSE_EMPLOYEE_LIMIT.billingPeriodDays;
  const candidate = getRinseProration(now, addDays(now, RINSE_EMPLOYEE_LIMIT.billingPeriodDays));

  const baseState: RinseEmployeeLimitState = {
    applies: false,
    maxActiveEmployees: RINSE_EMPLOYEE_LIMIT.maxActiveEmployees,
    activeEmployeeCount,
    activeEmployeeSlotsRemaining: null,
    currentPeriodStart: null,
    nextRenewalAt: null,
    monthlyPriceEur,
    dailyRateEur,
    proratedCreditLimitEur: RINSE_EMPLOYEE_LIMIT.proratedCreditLimitEur,
    pendingCreditEur: 0,
    remainingCreditEur: null,
    candidateChargeDays: candidate.chargeDays,
    candidateChargeEur: candidate.amount,
    archivedRetentionDays: RINSE_EMPLOYEE_LIMIT.archivedRetentionDays,
    canActivateEmployee: true,
    blockCode: null,
    blockMessage: null,
  };

  if (!account || !isRinseAccount(account, now)) {
    return baseState;
  }

  const { periodStart, nextRenewalAt } = getRinseBillingPeriod(getPeriodAnchor(account, now), now);
  const periodCandidate = getRinseProration(now, nextRenewalAt);
  const pendingCreditEur = getPendingCredit(employees, periodStart, nextRenewalAt);
  const remainingCreditEur = roundMoney(RINSE_EMPLOYEE_LIMIT.proratedCreditLimitEur - pendingCreditEur);
  let blockCode: RinseEmployeeLimitBlockCode | null = null;

  if (activeEmployeeCount >= RINSE_EMPLOYEE_LIMIT.maxActiveEmployees) {
    blockCode = "RINSE_ACTIVE_EMPLOYEE_LIMIT";
  } else if (roundMoney(pendingCreditEur + periodCandidate.amount) > RINSE_EMPLOYEE_LIMIT.proratedCreditLimitEur) {
    blockCode = "RINSE_PRORATE_PAYMENT_REQUIRED";
  }

  return {
    ...baseState,
    applies: true,
    activeEmployeeSlotsRemaining: Math.max(0, RINSE_EMPLOYEE_LIMIT.maxActiveEmployees - activeEmployeeCount),
    currentPeriodStart: toIso(periodStart),
    nextRenewalAt: toIso(nextRenewalAt),
    pendingCreditEur,
    remainingCreditEur,
    candidateChargeDays: periodCandidate.chargeDays,
    candidateChargeEur: periodCandidate.amount,
    canActivateEmployee: !blockCode,
    blockCode,
    blockMessage: blockCode ? getBlockMessage(blockCode) : null,
  };
}

export async function getRinseEmployeeActivationPatch(ownerAccountId: number, employee?: Employee, now = new Date()) {
  const account = await storage.getAccount(ownerAccountId);
  if (!account || !isRinseAccount(account, now)) {
    return { subscriptionPendingSince: undefined, details: await getRinseEmployeeLimitState(ownerAccountId, now) };
  }

  const { periodStart, nextRenewalAt } = getRinseBillingPeriod(getPeriodAnchor(account, now), now);
  const state = await getRinseEmployeeLimitState(ownerAccountId, now);

  if (state.activeEmployeeCount >= RINSE_EMPLOYEE_LIMIT.maxActiveEmployees) {
    throw new RinseEmployeeLimitError(403, "RINSE_ACTIVE_EMPLOYEE_LIMIT", getBlockMessage("RINSE_ACTIVE_EMPLOYEE_LIMIT"), state);
  }

  if (employee && wasPaidForCurrentPeriod(employee, periodStart)) {
    return { subscriptionPendingSince: null, details: state };
  }

  const candidate = getRinseProration(now, nextRenewalAt);
  if (roundMoney(state.pendingCreditEur + candidate.amount) > RINSE_EMPLOYEE_LIMIT.proratedCreditLimitEur) {
    throw new RinseEmployeeLimitError(402, "RINSE_PRORATE_PAYMENT_REQUIRED", getBlockMessage("RINSE_PRORATE_PAYMENT_REQUIRED"), state);
  }

  return { subscriptionPendingSince: now, details: state };
}

export async function assertCanDeactivateRinseEmployee(ownerAccountId: number, employee: Employee, now = new Date()) {
  const account = await storage.getAccount(ownerAccountId);
  if (!account || !isRinseAccount(account, now)) {
    return;
  }

  const { periodStart } = getRinseBillingPeriod(getPeriodAnchor(account, now), now);
  if (!isPendingInCurrentPeriod(employee, periodStart)) {
    return;
  }

  const state = await getRinseEmployeeLimitState(ownerAccountId, now);
  throw new RinseEmployeeLimitError(
    409,
    "RINSE_PENDING_EMPLOYEE_DELETE_REQUIRED",
    getBlockMessage("RINSE_PENDING_EMPLOYEE_DELETE_REQUIRED"),
    state,
  );
}

export function sendRinseLimitError(res: { status: (status: number) => { json: (body: unknown) => void } }, error: RinseEmployeeLimitError) {
  res.status(error.status).json({
    code: error.code,
    message: error.message,
    details: error.details,
  });
}

export function sendRinseFeatureLimitError(res: { status: (status: number) => { json: (body: unknown) => void } }, error: RinseFeatureLimitError) {
  res.status(error.status).json({
    code: error.code,
    message: error.message,
  });
}

export function sendPaidFeatureLimitError(res: { status: (status: number) => { json: (body: unknown) => void } }, error: PaidFeatureLimitError) {
  res.status(error.status).json({
    code: error.code,
    message: error.message,
  });
}
