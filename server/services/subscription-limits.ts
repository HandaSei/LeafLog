import type { Account, Employee } from "@shared/schema";
import {
  addDays,
  computeEffectiveSubscription,
  getRinseBillingPeriod,
  getRinseProration,
  RINSE_EMPLOYEE_LIMIT,
  type RinseEmployeeLimitBlockCode,
  type RinseEmployeeLimitState,
} from "@shared/subscription";
import { storage } from "../storage";

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

function isRinseAccount(account: Account, now: Date) {
  const subscription = computeEffectiveSubscription({
    tier: account.subscriptionTier,
    status: account.subscriptionStatus,
    trialEndsAt: account.subscriptionTrialEndsAt,
    giftExpiresAt: account.subscriptionGiftExpiresAt,
    updatedAt: account.subscriptionUpdatedAt,
  }, now);

  return subscription.effectiveTier === "rinse";
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
