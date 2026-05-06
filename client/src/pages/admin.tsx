import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Redirect } from "wouter";
import { ArrowUpDown, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getSubscriptionTier,
  SUBSCRIPTION_TIERS,
  type EffectiveSubscriptionStatus,
  type SubscriptionTierId,
} from "@shared/subscription";

interface SubscriptionSummary {
  tier: SubscriptionTierId;
  status: string;
  trialEndsAt: string | null;
  giftExpiresAt: string | null;
  updatedAt: string | null;
  effectiveTier: SubscriptionTierId;
  effectiveStatus: EffectiveSubscriptionStatus;
  effectiveEndsAt: string | null;
}

interface AccountRow {
  id: number;
  username: string;
  agencyName: string | null;
  email: string | null;
  role: string;
  createdAt: string | null;
  subscription: SubscriptionSummary;
}

type SortField = "username" | "createdAt";

function formatOptionalDate(value: string | null) {
  if (!value) return "No expiry";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No expiry" : format(date, "MMM d, yyyy");
}

function getStatusLabel(status: EffectiveSubscriptionStatus) {
  if (status === "trial") return "Trial";
  if (status === "gifted") return "Gifted";
  if (status === "active") return "Active";
  if (status === "expired") return "Expired";
  return "Free";
}

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("username");
  const [sortAsc, setSortAsc] = useState(true);
  const [giftAccount, setGiftAccount] = useState<AccountRow | null>(null);
  const [giftTier, setGiftTier] = useState<SubscriptionTierId>("ceremony");
  const [giftExpiresAt, setGiftExpiresAt] = useState("");

  const { data: accounts, isLoading, isFetching } = useQuery<AccountRow[]>({
    queryKey: ["/api/admin/accounts"],
  });
  const isUpdating = !isLoading && isFetching;

  const giftMutation = useMutation({
    mutationFn: async ({ accountId, tier, expiresAt }: { accountId: number; tier: SubscriptionTierId; expiresAt: string | null }) => {
      const res = await apiRequest("PATCH", `/api/admin/accounts/${accountId}/subscription-gift`, { tier, expiresAt });
      return res.json() as Promise<AccountRow>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<AccountRow[]>(["/api/admin/accounts"], (current) =>
        current?.map((account) => (account.id === updated.id ? { ...account, ...updated } : account)),
      );
      queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts"] });
      setGiftAccount(null);
      setGiftExpiresAt("");
      toast({
        title: "Subscription gifted",
        description: `${updated.username} is now on ${getSubscriptionTier(updated.subscription.effectiveTier).name}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Gift failed", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = search.toLowerCase().trim();
    let list = accounts;
    if (q) {
      list = list.filter(
        (account) =>
          account.username.toLowerCase().includes(q) ||
          (account.agencyName && account.agencyName.toLowerCase().includes(q)) ||
          (account.email && account.email.toLowerCase().includes(q)),
      );
    }
    list = [...list].sort((a, b) => {
      if (sortField === "username") {
        const cmp = a.username.localeCompare(b.username);
        return sortAsc ? cmp : -cmp;
      }
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return sortAsc ? da - db : db - da;
    });
    return list;
  }, [accounts, search, sortAsc, sortField]);

  if (!isAdmin) {
    return <Redirect to="/" />;
  }

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const openGiftDialog = (account: AccountRow) => {
    setGiftAccount(account);
    setGiftTier(account.subscription?.effectiveTier ?? "ceremony");
    setGiftExpiresAt("");
  };

  const saveGift = () => {
    if (!giftAccount) return;
    giftMutation.mutate({
      accountId: giftAccount.id,
      tier: giftTier,
      expiresAt: giftExpiresAt || null,
    });
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle data-testid="text-admin-title">All Accounts</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-accounts"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isUpdating && (
            <div className="mb-3 text-[11px] text-muted-foreground">
              Updating accounts...
            </div>
          )}
          {isLoading ? (
            <div className="flex min-h-[180px] items-center justify-center text-sm text-muted-foreground">
              Loading accounts...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSort("username")}
                        className="gap-1 -ml-3"
                        data-testid="button-sort-name"
                      >
                        Agency / Username
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </Button>
                    </TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSort("createdAt")}
                        className="gap-1 -ml-3"
                        data-testid="button-sort-date"
                      >
                        Date Created
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        {search ? "No accounts match your search." : "No accounts found."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((account) => (
                      <TableRow key={account.id} data-testid={`row-account-${account.id}`}>
                        <TableCell>
                          <div>
                            {account.agencyName && (
                              <div className="font-medium" data-testid={`text-agency-${account.id}`}>
                                {account.agencyName}
                              </div>
                            )}
                            <div
                              className={account.agencyName ? "text-sm text-muted-foreground" : "font-medium"}
                              data-testid={`text-username-${account.id}`}
                            >
                              {account.username}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-email-${account.id}`}>
                          {account.email || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={account.role === "admin" ? "default" : "secondary"}
                            data-testid={`badge-role-${account.id}`}
                          >
                            {account.role}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-subscription-${account.id}`}>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {getSubscriptionTier(account.subscription.effectiveTier).name}
                              </span>
                              <Badge variant={account.subscription.effectiveStatus === "expired" ? "secondary" : "outline"}>
                                {getStatusLabel(account.subscription.effectiveStatus)}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatOptionalDate(account.subscription.effectiveEndsAt)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-date-${account.id}`}>
                          {account.createdAt ? format(new Date(account.createdAt), "MMM d, yyyy") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openGiftDialog(account)}
                            data-testid={`button-gift-subscription-${account.id}`}
                          >
                            Gift Tier
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {!isLoading && filtered.length > 0 && (
            <div className="mt-3 text-sm text-muted-foreground" data-testid="text-account-count">
              {filtered.length} account{filtered.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!giftAccount} onOpenChange={(open) => !open && setGiftAccount(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Gift Subscription</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium">{giftAccount?.agencyName || giftAccount?.username}</p>
              <p className="text-xs text-muted-foreground">{giftAccount?.email || "No email"}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Tier</Label>
              <Select value={giftTier} onValueChange={(value) => setGiftTier(value as SubscriptionTierId)}>
                <SelectTrigger data-testid="select-admin-gift-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBSCRIPTION_TIERS.map((tier) => (
                    <SelectItem key={tier.id} value={tier.id}>
                      {tier.name} - {tier.priceLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gift-expires-at">Gift Until</Label>
              <Input
                id="gift-expires-at"
                type="date"
                value={giftExpiresAt}
                onChange={(event) => setGiftExpiresAt(event.target.value)}
                data-testid="input-admin-gift-expiry"
              />
              <p className="text-[11px] text-muted-foreground">Leave empty for no expiry.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGiftAccount(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveGift}
              disabled={giftMutation.isPending}
              data-testid="button-save-admin-gift"
            >
              {giftMutation.isPending ? "Saving..." : "Gift Tier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
