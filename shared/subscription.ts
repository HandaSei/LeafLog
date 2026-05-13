export const SUBSCRIPTION_TIER_IDS = ["raw", "rinse", "first_pour", "gongfu", "ceremony"] as const;
export const PAID_TRIAL_TIER_IDS = ["rinse", "first_pour", "gongfu"] as const;
export const SUBSCRIPTION_STATUS_IDS = ["free", "trial", "active", "gifted"] as const;

export type SubscriptionTierId = (typeof SUBSCRIPTION_TIER_IDS)[number];
export type PaidTrialTierId = (typeof PAID_TRIAL_TIER_IDS)[number];
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS_IDS)[number];
export type EffectiveSubscriptionStatus = SubscriptionStatus | "expired";

export const EXISTING_ACCOUNT_TRIAL_END_LOCAL = "2026-05-31T23:59:59.999";
export const NEW_ACCOUNT_TRIAL_DAYS_BY_TIER: Record<PaidTrialTierId, number> = {
  rinse: 14,
  first_pour: 7,
  gongfu: 5,
};
export const RAW_ARCHIVED_RETENTION_DAYS = 90;

export const RINSE_EMPLOYEE_LIMIT = {
  maxActiveEmployees: 30,
  monthlyPriceEur: 1.65,
  proratedCreditLimitEur: 8,
  billingPeriodDays: 30,
  archivedRetentionDays: 180,
} as const;

export const RINSE_PLAN_LIMITS = {
  timesheetHistoryDays: 180,
  maxCustomRoles: 6,
  allowPerEmployeeBreakExceptions: false,
  allowManualTimesheetBackups: false,
  retainedImportBackups: 1,
  maxKioskDevices: 1,
} as const;

export type RinseEmployeeLimitBlockCode =
  | "RINSE_ACTIVE_EMPLOYEE_LIMIT"
  | "RINSE_PRORATE_PAYMENT_REQUIRED"
  | "RINSE_PENDING_EMPLOYEE_DELETE_REQUIRED";

export type RinseEmployeeLimitState = {
  applies: boolean;
  maxActiveEmployees: number;
  activeEmployeeCount: number;
  activeEmployeeSlotsRemaining: number | null;
  currentPeriodStart: string | null;
  nextRenewalAt: string | null;
  monthlyPriceEur: number;
  dailyRateEur: number;
  proratedCreditLimitEur: number;
  pendingCreditEur: number;
  remainingCreditEur: number | null;
  candidateChargeDays: number;
  candidateChargeEur: number;
  archivedRetentionDays: number;
  canActivateEmployee: boolean;
  blockCode: RinseEmployeeLimitBlockCode | null;
  blockMessage: string | null;
};

export const SUBSCRIPTION_TIERS: Array<{
  id: SubscriptionTierId;
  name: string;
  priceLabel: string;
  description: string;
}> = [
  {
    id: "raw",
    name: "Raw",
    priceLabel: "Free",
    description: "Free fallback tier.",
  },
  {
    id: "rinse",
    name: "Rinse",
    priceLabel: "1.65€ / employee / mo",
    description: "Light paid tier.",
  },
  {
    id: "first_pour",
    name: "First Pour",
    priceLabel: "2.10€ / employee / mo",
    description: "Balanced paid tier.",
  },
  {
    id: "gongfu",
    name: "Gongfu",
    priceLabel: "2.90€ / employee / mo",
    description: "Advanced paid tier.",
  },
  {
    id: "ceremony",
    name: "Ceremony",
    priceLabel: "4.20€ / employee / mo",
    description: "Unlimited version.",
  },
];

const SUBSCRIPTION_TIER_SET = new Set<string>(SUBSCRIPTION_TIER_IDS);
const SUBSCRIPTION_STATUS_SET = new Set<string>(SUBSCRIPTION_STATUS_IDS);

export function getSubscriptionTier(id: string | null | undefined) {
  return SUBSCRIPTION_TIERS.find((tier) => tier.id === id) ?? SUBSCRIPTION_TIERS[0];
}

export function normalizeSubscriptionTier(id: string | null | undefined): SubscriptionTierId {
  return SUBSCRIPTION_TIER_SET.has(id ?? "") ? (id as SubscriptionTierId) : "raw";
}

export function normalizeSubscriptionStatus(status: string | null | undefined): SubscriptionStatus {
  return SUBSCRIPTION_STATUS_SET.has(status ?? "") ? (status as SubscriptionStatus) : "free";
}

export function getExistingAccountTrialEndDate() {
  return new Date(EXISTING_ACCOUNT_TRIAL_END_LOCAL);
}

export function getNewAccountTrialDays(tier: string | null | undefined) {
  return NEW_ACCOUNT_TRIAL_DAYS_BY_TIER[normalizePaidTrialTier(tier)];
}

export function normalizePaidTrialTier(tier: string | null | undefined): PaidTrialTierId {
  return PAID_TRIAL_TIER_IDS.includes(tier as PaidTrialTierId) ? (tier as PaidTrialTierId) : "rinse";
}

export function getNewAccountTrialEndDate(tier: string | null | undefined = "rinse", now = new Date()) {
  return new Date(now.getTime() + getNewAccountTrialDays(tier) * 24 * 60 * 60 * 1000);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function getRinseBillingPeriod(anchor: Date, now = new Date()) {
  let periodStart = new Date(anchor);
  const periodLengthMs = RINSE_EMPLOYEE_LIMIT.billingPeriodDays * 24 * 60 * 60 * 1000;

  if (Number.isNaN(periodStart.getTime()) || periodStart.getTime() > now.getTime()) {
    periodStart = new Date(now);
  }

  const elapsedPeriods = Math.max(0, Math.floor((now.getTime() - periodStart.getTime()) / periodLengthMs));
  periodStart = new Date(periodStart.getTime() + elapsedPeriods * periodLengthMs);

  return {
    periodStart,
    nextRenewalAt: new Date(periodStart.getTime() + periodLengthMs),
  };
}

export function getRinseProration(activatedAt: Date, nextRenewalAt: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  const remainingMs = Math.max(0, nextRenewalAt.getTime() - activatedAt.getTime());
  const chargeDays = Math.min(
    RINSE_EMPLOYEE_LIMIT.billingPeriodDays,
    Math.max(0, Math.ceil(remainingMs / dayMs)),
  );
  const dailyRate = RINSE_EMPLOYEE_LIMIT.monthlyPriceEur / RINSE_EMPLOYEE_LIMIT.billingPeriodDays;
  const amount = Math.round(chargeDays * dailyRate * 1000) / 1000;

  return {
    chargeDays,
    dailyRate,
    amount,
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | string | null | undefined): string | null {
  return toDate(value)?.toISOString() ?? null;
}

export function computeEffectiveSubscription(
  input: {
    tier?: string | null;
    status?: string | null;
    trialEndsAt?: Date | string | null;
    giftExpiresAt?: Date | string | null;
    updatedAt?: Date | string | null;
  },
  now = new Date(),
) {
  const storedTier = normalizeSubscriptionTier(input.tier);
  const storedStatus = normalizeSubscriptionStatus(input.status);
  const trialEndsAt = toDate(input.trialEndsAt);
  const giftExpiresAt = toDate(input.giftExpiresAt);
  const nowTime = now.getTime();

  let effectiveTier: SubscriptionTierId = "raw";
  let effectiveStatus: EffectiveSubscriptionStatus = "free";
  let effectiveEndsAt: Date | null = null;

  if (storedStatus === "gifted" && (!giftExpiresAt || giftExpiresAt.getTime() >= nowTime)) {
    effectiveTier = storedTier;
    effectiveStatus = "gifted";
    effectiveEndsAt = giftExpiresAt;
  } else if (storedStatus === "trial" && trialEndsAt && trialEndsAt.getTime() >= nowTime) {
    effectiveTier = storedTier;
    effectiveStatus = "trial";
    effectiveEndsAt = trialEndsAt;
  } else if (storedStatus === "active") {
    effectiveTier = storedTier;
    effectiveStatus = "active";
  } else if (storedTier !== "raw") {
    effectiveStatus = "expired";
  }

  return {
    tier: storedTier,
    status: storedStatus,
    trialEndsAt: toIso(trialEndsAt),
    giftExpiresAt: toIso(giftExpiresAt),
    updatedAt: toIso(input.updatedAt),
    effectiveTier,
    effectiveStatus,
    effectiveEndsAt: toIso(effectiveEndsAt),
  };
}
