import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, TriangleAlert, User } from "lucide-react";

type DeleteAccountStep = "closed" | "password" | "confirm";

type SettingsUser = {
  username: string;
  agencyName: string | null;
  role: string;
} | null | undefined;

interface SettingsAccountTabProps {
  user: SettingsUser;
  showDangerZone: boolean;
  setShowDangerZone: (updater: (visible: boolean) => boolean) => void;
  setDeleteAccountStep: (step: DeleteAccountStep) => void;
}

export function SettingsAccountTab({
  user,
  showDangerZone,
  setShowDangerZone,
  setDeleteAccountStep,
}: SettingsAccountTabProps) {
  return (
    <TabsContent value="account" className="space-y-6 mt-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <div>
              <CardTitle className="text-base">Account Info</CardTitle>
              <CardDescription className="text-xs mt-0.5">Your account details</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Username</p>
              <p className="font-medium" data-testid="text-account-username">{user?.username}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Agency</p>
              <p className="font-medium" data-testid="text-account-agency">{user?.agencyName ?? "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Role</p>
              <p className="font-medium capitalize" data-testid="text-account-role">{user?.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          onClick={() => setShowDangerZone((v) => !v)}
          data-testid="button-toggle-danger-zone"
        >
          {showDangerZone ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Show dangerous actions
        </button>

        {showDangerZone && (
          <Card className="border-destructive/30 mt-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <TriangleAlert className="w-4 h-4 text-destructive" />
                <div>
                  <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Irreversible actions — please proceed with caution
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-3 rounded-lg border border-destructive/20 bg-destructive/5">
                <div>
                  <p className="text-sm font-medium">Delete Account</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently deletes your account, all employees, shifts, and data.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteAccountStep("password")}
                  data-testid="button-delete-account"
                >
                  Delete Account
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </TabsContent>
  );
}
