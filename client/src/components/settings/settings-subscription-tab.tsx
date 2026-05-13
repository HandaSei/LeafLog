import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { AlertCircle, Check, Crown } from "lucide-react";
import {
  getSubscriptionTier,
  RAW_ARCHIVED_RETENTION_DAYS,
  RINSE_PLAN_LIMITS,
  SUBSCRIPTION_TIERS,
  type EffectiveSubscriptionStatus,
  type SubscriptionTierId,
} from "@shared/subscription";

export type SubscriptionSummary = {
  adminExempt?: boolean;
  tier: SubscriptionTierId;
  status: string;
  trialEndsAt: string | null;
  giftExpiresAt: string | null;
  updatedAt: string | null;
  effectiveTier: SubscriptionTierId;
  effectiveStatus: EffectiveSubscriptionStatus;
  effectiveEndsAt: string | null;
};

interface SettingsSubscriptionTabProps {
  subscription: SubscriptionSummary | undefined;
  isLoading: boolean;
  isAdmin: boolean;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No expiry";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No expiry";
  return format(date, "MMM d, yyyy");
}

function getStatusLabel(status: EffectiveSubscriptionStatus) {
  switch (status) {
    case "trial":
      return "Trial";
    case "gifted":
      return "Gifted";
    case "active":
      return "Active";
    case "expired":
      return "Expired";
    default:
      return "Free";
  }
}

export function SettingsSubscriptionTab({ subscription, isLoading, isAdmin }: SettingsSubscriptionTabProps) {
  const effectiveTier = subscription?.effectiveTier ?? "raw";
  const currentTier = getSubscriptionTier(effectiveTier);
  const status = subscription?.effectiveStatus ?? "free";

  return (
    <TabsContent value="subscription" className="space-y-6 mt-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-primary" />
            <div>
              <CardTitle className="text-base">Subscription</CardTitle>
              <CardDescription className="text-xs mt-0.5">Current tier and upcoming plans</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Account Type</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-xl font-bold" data-testid="text-current-subscription-tier">
                  Administrator
                </p>
                <Badge variant="default">Plan exempt</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Admin accounts are used to manage LeafLog and do not need a subscription tier.
              </p>
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-44 w-full" />
            </div>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Current Plan</p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-xl font-bold" data-testid="text-current-subscription-tier">
                        {currentTier.name}
                      </p>
                      <Badge variant={status === "expired" ? "secondary" : "default"}>
                        {getStatusLabel(status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{currentTier.priceLabel}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {status === "trial" ? "Trial Ends" : status === "gifted" ? "Gift Ends" : "Renews"}
                    </p>
                    <p className="mt-1 text-sm font-medium" data-testid="text-current-subscription-expiry">
                      {status === "active" ? "Manual billing later" : formatDate(subscription?.effectiveEndsAt)}
                    </p>
                  </div>
                </div>
              </div>

              {status === "expired" && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  <div className="flex gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <p>
                      Your trial has ended, so this account is now on Raw until you upgrade to a paid plan. When Raw employee limits are activated, employees above that limit will be archived with {RAW_ARCHIVED_RETENTION_DAYS} days of data retention.
                    </p>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto pb-2">
                <div className="grid min-w-[920px] grid-cols-5 gap-3">
                  {SUBSCRIPTION_TIERS.map((tier) => {
                    const isCurrent = tier.id === effectiveTier;
                    return (
                      <div
                        key={tier.id}
                        className={`rounded-lg border p-4 ${
                          isCurrent ? "border-primary bg-primary/5" : "bg-card"
                        }`}
                        data-testid={`card-subscription-tier-${tier.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">{tier.name}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{tier.priceLabel}</p>
                          </div>
                          {isCurrent && (
                            <Badge variant="outline" className="gap-1">
                              <Check className="h-3 w-3" />
                              Current
                            </Badge>
                          )}
                        </div>
                        <p className="mt-4 text-xs text-muted-foreground">{tier.description}</p>
                        <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                          {tier.id === "rinse"
                            ? `Up to 30 active employees, ${RINSE_PLAN_LIMITS.timesheetHistoryDays} days of timesheet history, ${RINSE_PLAN_LIMITS.maxCustomRoles} custom roles, one SteepIn device, general break policy only, and one automatic CSV-import backup.`
                            : "Unlimited while plan limits are not active."}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
