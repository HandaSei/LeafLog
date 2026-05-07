import type { Account } from "@shared/schema";
import { computeEffectiveSubscription, getSubscriptionTier, RAW_ARCHIVED_RETENTION_DAYS } from "@shared/subscription";
import { pool, storage } from "../storage";

const TRIAL_EXPIRED_NOTICE_TYPE = "subscription-trial-expired";

function getEffectiveSubscription(account: Account) {
  return computeEffectiveSubscription({
    tier: account.subscriptionTier,
    status: account.subscriptionStatus,
    trialEndsAt: account.subscriptionTrialEndsAt,
    giftExpiresAt: account.subscriptionGiftExpiresAt,
    updatedAt: account.subscriptionUpdatedAt,
  });
}

export async function ensureTrialExpiredRawNotice(account: Account) {
  if (account.role !== "manager") return false;

  const subscription = getEffectiveSubscription(account);
  if (subscription.effectiveStatus !== "expired") return false;

  const existing = await pool.query(
    "SELECT id FROM notifications WHERE account_id = $1 AND type = $2 LIMIT 1",
    [account.id, TRIAL_EXPIRED_NOTICE_TYPE],
  );
  if (existing.rows.length > 0) return false;

  const previousTier = getSubscriptionTier(subscription.tier);
  await storage.createNotification({
    accountId: account.id,
    type: TRIAL_EXPIRED_NOTICE_TYPE,
    title: "Trial ended",
    message: `Your ${previousTier.name} trial has ended. Until you upgrade to a paid plan, your account is now on Raw. When Raw employee limits are activated, employees above that limit will be archived with ${RAW_ARCHIVED_RETENTION_DAYS} days of retention.`,
    data: JSON.stringify({
      previousTier: subscription.tier,
      effectiveTier: "raw",
      rawArchivedRetentionDays: RAW_ARCHIVED_RETENTION_DAYS,
    }),
  });

  return true;
}
