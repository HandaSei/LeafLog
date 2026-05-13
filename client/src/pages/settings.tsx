import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/components/theme-provider";
import type { CustomRole, TimesheetBackup, Employee, KioskDevice } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ROLE_COLORS } from "@/lib/constants";
import { SettingsManagementTab } from "@/components/settings/settings-management-tab";
import { SettingsAccountTab } from "@/components/settings/settings-account-tab";
import { SettingsAestheticTab } from "@/components/settings/settings-aesthetic-tab";
import { SettingsSubscriptionTab, type SubscriptionSummary } from "@/components/settings/settings-subscription-tab";
import { isActiveUnarchivedEmployee } from "@/lib/employees";
import { RINSE_PLAN_LIMITS } from "@shared/subscription";

type SettingsTab = "management" | "account" | "aesthetic" | "subscription";

function readCachedSteepInTheme() {
  try {
    const cached = localStorage.getItem("leaflog_steepin_theme");
    if (cached) {
      const parsed = JSON.parse(cached);
      return {
        mode: parsed.mode || "light",
        dayStartHour: parsed.dayStartHour ?? 7,
        nightStartHour: parsed.nightStartHour ?? 19,
      };
    }
  } catch {}
  return { mode: "light", dayStartHour: 7, nightStartHour: 19 };
}

function useDeferredSettingsQueries() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const win = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const hasIdleCallback = typeof win.requestIdleCallback === "function";
    const task = hasIdleCallback
      ? win.requestIdleCallback!(() => setEnabled(true), { timeout: 1500 })
      : window.setTimeout(() => setEnabled(true), 450);

    return () => {
      if (hasIdleCallback && win.cancelIdleCallback) {
        win.cancelIdleCallback(task);
      } else {
        window.clearTimeout(task);
      }
    };
  }, []);

  return enabled;
}

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const deferredSettingsQueriesEnabled = useDeferredSettingsQueries();
  const [activeTab, setActiveTab] = useState<SettingsTab>("management");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState(ROLE_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteAccountStep, setDeleteAccountStep] = useState<"closed" | "password" | "confirm">("closed");
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [paidBreakInput, setPaidBreakInput] = useState<string>("");
  const [maxBreakInput, setMaxBreakInput] = useState<string>("");
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const [empExceptionOpen, setEmpExceptionOpen] = useState(false);
  const [empExceptionId, setEmpExceptionId] = useState<string>("");
  const [empExceptionPaid, setEmpExceptionPaid] = useState<string>("");
  const [empExceptionMax, setEmpExceptionMax] = useState<string>("");
  const [notifSettings, setNotifSettings] = useState<{
    notifyLate: boolean;
    notifyEarlyClockOut: boolean;
    notifyNotes: boolean;
    notifyApprovals: boolean;
    lateThresholdMinutes: number;
    earlyClockOutThresholdMinutes: number;
    timezone: string;
  } | null>(null);
  const [renamingDeviceId, setRenamingDeviceId] = useState<number | null>(null);
  const [renameDeviceValue, setRenameDeviceValue] = useState("");
  const [themeMode, setThemeMode] = useState<string>(() => readCachedSteepInTheme().mode);
  const [dayStartHour, setDayStartHour] = useState<number>(() => readCachedSteepInTheme().dayStartHour);
  const [nightStartHour, setNightStartHour] = useState<number>(() => readCachedSteepInTheme().nightStartHour);

  const { theme: managerTheme, setTheme: setManagerTheme } = useTheme();
  const shouldLoadDeferredManagement = deferredSettingsQueriesEnabled && activeTab === "management";

  const { data: roles = [], isLoading } = useQuery<CustomRole[]>({
    queryKey: ["/api/roles"],
  });

  const { data: breakPolicy, isLoading: policyLoading } = useQuery<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }>({
    queryKey: ["/api/settings/break-policy"],
    select: (data) => {
      if (paidBreakInput === "" && data.paidBreakMinutes !== null) setPaidBreakInput(String(data.paidBreakMinutes));
      if (maxBreakInput === "" && data.maxBreakMinutes !== null) setMaxBreakInput(String(data.maxBreakMinutes));
      return data;
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const { data: subscription, isLoading: subscriptionLoading } = useQuery<SubscriptionSummary>({
    queryKey: ["/api/subscription"],
    enabled: user?.role !== "admin",
  });
  const isRinsePlan = subscription?.effectiveTier === "rinse";

  const { data: backups = [], isLoading: backupsLoading } = useQuery<Omit<TimesheetBackup, "snapshot">[]>({
    queryKey: ["/api/backups"],
    enabled: shouldLoadDeferredManagement,
  });

  const createBackupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backups");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      toast({ title: "Backup created", description: "Your timesheet data has been backed up." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/backups/${id}/restore`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] });
      setConfirmRestoreId(null);
      toast({ title: "Backup restored", description: `${data.restored} time entries have been restored.` });
    },
    onError: (err: Error) => {
      setConfirmRestoreId(null);
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/backups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      toast({ title: "Backup deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: kioskDevices = [], isLoading: devicesLoading } = useQuery<KioskDevice[]>({
    queryKey: ["/api/devices"],
    enabled: shouldLoadDeferredManagement,
  });

  const lockDeviceMutation = useMutation({
    mutationFn: async ({ id, isLocked }: { id: number; isLocked: boolean }) => {
      const res = await apiRequest("PATCH", `/api/devices/${id}/lock`, { isLocked });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/devices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ title: "Device removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const renameDeviceMutation = useMutation({
    mutationFn: async ({ id, deviceName }: { id: number; deviceName: string }) => {
      const res = await apiRequest("PATCH", `/api/devices/${id}/rename`, { deviceName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      setRenamingDeviceId(null);
      setRenameDeviceValue("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  useQuery<any>({
    queryKey: ["/api/settings/steepin-theme"],
    enabled: activeTab === "aesthetic",
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings/steepin-theme");
      const s = await res.json();
      setThemeMode(s.mode || "light");
      setDayStartHour(s.dayStartHour ?? 7);
      setNightStartHour(s.nightStartHour ?? 19);
      return s;
    },
  });

  const updateThemeMutation = useMutation({
    mutationFn: async (data: { mode?: string; dayStartHour?: number; nightStartHour?: number }) => {
      const res = await apiRequest("PATCH", "/api/settings/steepin-theme", data);
      return res.json();
    },
    onSuccess: (data) => {
      try {
        localStorage.setItem("leaflog_steepin_theme", JSON.stringify({
          mode: themeMode,
          dayStartHour,
          nightStartHour,
          ...data,
        }));
      } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/settings/steepin-theme"] });
      toast({ title: "SteepIn theme updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });


  const { isLoading: notifLoading } = useQuery<any>({
    queryKey: ["/api/settings/notifications"],
    select: (data: any) => {
      if (!notifSettings) setNotifSettings(data);
      return data;
    },
  });

  const updateNotifMutation = useMutation({
    mutationFn: async (data: Partial<typeof notifSettings>) => {
      const res = await apiRequest("PATCH", "/api/settings/notifications", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/notifications"] });
      setNotifSettings(data);
      toast({ title: "Notification settings saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updatePolicyMutation = useMutation({
    mutationFn: async (data: { paidBreakMinutes: number | null; maxBreakMinutes: number | null }) => {
      const res = await apiRequest("PATCH", "/api/settings/break-policy", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/break-policy"] });
      toast({ title: "Break policy saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSavePolicy = () => {
    const paid = paidBreakInput === "" ? null : Number(paidBreakInput);
    const max = maxBreakInput === "" ? null : Number(maxBreakInput);
    updatePolicyMutation.mutate({ paidBreakMinutes: paid, maxBreakMinutes: max });
  };

  const updateEmpExceptionMutation = useMutation({
    mutationFn: async ({ id, paidBreakMinutes, maxBreakMinutes }: { id: number; paidBreakMinutes: number | null; maxBreakMinutes: number | null }) => {
      const res = await apiRequest("PATCH", `/api/employees/${id}/break-policy`, { paidBreakMinutes, maxBreakMinutes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setEmpExceptionOpen(false);
      setEmpExceptionId("");
      setEmpExceptionPaid("");
      setEmpExceptionMax("");
      toast({ title: "Exception saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeEmpExceptionMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/employees/${id}/break-policy`, { paidBreakMinutes: null, maxBreakMinutes: null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Exception removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEmpException = (emp?: Employee) => {
    if (isRinsePlan) {
      toast({
        title: "Rinse uses one break policy",
        description: "Per-employee break exceptions are available on higher tiers.",
      });
      return;
    }
    setEmpExceptionId(emp ? String(emp.id) : "");
    setEmpExceptionPaid(emp?.paidBreakMinutes != null ? String(emp.paidBreakMinutes) : "");
    setEmpExceptionMax(emp?.maxBreakMinutes != null ? String(emp.maxBreakMinutes) : "");
    setEmpExceptionOpen(true);
  };

  const handleSaveEmpException = () => {
    if (!empExceptionId) return;
    const paid = empExceptionPaid === "" ? null : Number(empExceptionPaid);
    const max = empExceptionMax === "" ? null : Number(empExceptionMax);
    updateEmpExceptionMutation.mutate({ id: Number(empExceptionId), paidBreakMinutes: paid, maxBreakMinutes: max });
  };

  const breakPolicyEmployees = employees.filter(isActiveUnarchivedEmployee);
  const employeesWithExceptions = breakPolicyEmployees.filter(e => e.paidBreakMinutes != null || e.maxBreakMinutes != null);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      const res = await apiRequest("POST", "/api/roles", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setNewRoleName("");
      setNewRoleColor(ROLE_COLORS[0]);
      toast({ title: "Role added", description: "New role has been created." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, color }: { id: number; name: string; color: string }) => {
      const res = await apiRequest("PATCH", `/api/roles/${id}`, { name, color });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setEditingId(null);
      setEditingName("");
      setEditingColor("");
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setDeletingId(null);
      toast({ title: "Role removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (password: string) => {
      await apiRequest("DELETE", "/api/auth/account", { password });
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
    },
    onError: (err: Error) => {
      setDeletePasswordError(err.message);
    },
  });

  const handlePasswordCheck = () => {
    if (!deletePassword.trim()) {
      setDeletePasswordError("Password is required");
      return;
    }
    setDeletePasswordError("");
    setDeleteAccountStep("confirm");
  };

  const handleFinalDelete = () => {
    deleteAccountMutation.mutate(deletePassword);
  };

  const closeDeleteFlow = () => {
    setDeleteAccountStep("closed");
    setDeletePassword("");
    setDeletePasswordError("");
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    if (isRinsePlan && roles.length >= RINSE_PLAN_LIMITS.maxCustomRoles) {
      toast({
        title: "Role limit reached",
        description: `Rinse supports up to ${RINSE_PLAN_LIMITS.maxCustomRoles} custom roles.`,
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({ name: newRoleName.trim(), color: newRoleColor });
  };

  const startEdit = (role: CustomRole) => {
    setEditingId(role.id);
    setEditingName(role.name);
    setEditingColor(role.color || ROLE_COLORS[0]);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
    setEditingColor("");
  };

  const saveEdit = () => {
    if (!editingName.trim() || editingId === null) return;
    updateMutation.mutate({ id: editingId, name: editingName.trim(), color: editingColor });
  };


  return (
    <div className="flex flex-col h-full overflow-auto p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Settings2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account preferences</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)} className="w-full">
        <TabsList className="w-full grid grid-cols-4 mb-2">
          <TabsTrigger value="management" className="px-1 text-[11px] sm:text-sm" data-testid="tab-management">Management</TabsTrigger>
          <TabsTrigger value="account" className="px-1 text-[11px] sm:text-sm" data-testid="tab-account">Account</TabsTrigger>
          <TabsTrigger value="aesthetic" className="px-1 text-[11px] sm:text-sm" data-testid="tab-aesthetic">Aesthetic</TabsTrigger>
          <TabsTrigger value="subscription" className="px-1 text-[11px] sm:text-sm" data-testid="tab-subscription">Subscription</TabsTrigger>
        </TabsList>

        {/* ── MANAGEMENT TAB ── */}
        <SettingsManagementTab
          policyLoading={policyLoading}
          paidBreakInput={paidBreakInput}
          setPaidBreakInput={setPaidBreakInput}
          maxBreakInput={maxBreakInput}
          setMaxBreakInput={setMaxBreakInput}
          updatePolicyMutation={updatePolicyMutation}
          handleSavePolicy={handleSavePolicy}
          openEmpException={openEmpException}
          employeesWithExceptions={employeesWithExceptions}
          removeEmpExceptionMutation={removeEmpExceptionMutation}
          notifLoading={notifLoading}
          notifSettings={notifSettings}
          setNotifSettings={setNotifSettings}
          updateNotifMutation={updateNotifMutation}
          deferredSettingsQueriesEnabled={deferredSettingsQueriesEnabled}
          devicesLoading={devicesLoading}
          kioskDevices={kioskDevices}
          renamingDeviceId={renamingDeviceId}
          renameDeviceValue={renameDeviceValue}
          setRenameDeviceValue={setRenameDeviceValue}
          setRenamingDeviceId={setRenamingDeviceId}
          renameDeviceMutation={renameDeviceMutation}
          lockDeviceMutation={lockDeviceMutation}
          deleteDeviceMutation={deleteDeviceMutation}
          createBackupMutation={{ isPending: createBackupMutation.isPending, mutate: () => createBackupMutation.mutate() }}
          backupsLoading={backupsLoading}
          backups={backups}
          isRinsePlan={isRinsePlan}
          rinseMaxCustomRoles={RINSE_PLAN_LIMITS.maxCustomRoles}
          setConfirmRestoreId={setConfirmRestoreId}
          restoreBackupMutation={restoreBackupMutation}
          deleteBackupMutation={deleteBackupMutation}
          roles={roles}
          isLoading={isLoading}
          editingId={editingId}
          editingName={editingName}
          setEditingName={setEditingName}
          editingColor={editingColor}
          setEditingColor={setEditingColor}
          saveEdit={saveEdit}
          cancelEdit={cancelEdit}
          updateMutation={updateMutation}
          startEdit={startEdit}
          setDeletingId={setDeletingId}
          newRoleColor={newRoleColor}
          setNewRoleColor={setNewRoleColor}
          newRoleName={newRoleName}
          setNewRoleName={setNewRoleName}
          handleAdd={handleAdd}
          createMutation={createMutation}
        />

        <SettingsAccountTab
          user={user}
          showDangerZone={showDangerZone}
          setShowDangerZone={setShowDangerZone}
          setDeleteAccountStep={setDeleteAccountStep}
        />

        <SettingsAestheticTab
          managerTheme={managerTheme}
          setManagerTheme={setManagerTheme}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          updateThemeMutation={updateThemeMutation}
          dayStartHour={dayStartHour}
          setDayStartHour={setDayStartHour}
          nightStartHour={nightStartHour}
          setNightStartHour={setNightStartHour}
        />

        <SettingsSubscriptionTab
          subscription={subscription}
          isLoading={subscriptionLoading}
          isAdmin={user?.role === "admin"}
        />
      </Tabs>

      <Dialog open={deleteAccountStep === "password"} onOpenChange={(open) => !open && closeDeleteFlow()}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Confirm Your Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Enter your current password to continue with account deletion.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="del-password">Password</Label>
              <Input
                id="del-password"
                type="password"
                placeholder="Your current password"
                value={deletePassword}
                onChange={(e) => { setDeletePassword(e.target.value); setDeletePasswordError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handlePasswordCheck()}
                autoFocus
                data-testid="input-delete-password"
              />
              {deletePasswordError && (
                <p className="text-xs text-destructive">{deletePasswordError}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              variant="destructive"
              onClick={handlePasswordCheck}
              disabled={!deletePassword.trim()}
              className="w-full sm:w-auto px-8"
              data-testid="button-confirm-password"
            >
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRestoreId} onOpenChange={(open) => !open && setConfirmRestoreId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace <strong>all current timesheet data</strong> with the entries from this backup. This action cannot be undone — consider creating a fresh backup first if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRestoreId && restoreBackupMutation.mutate(confirmRestoreId)}
              disabled={restoreBackupMutation.isPending}
              data-testid="button-confirm-restore"
            >
              {restoreBackupMutation.isPending ? "Restoring…" : "Yes, restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAccountStep === "confirm"} onOpenChange={(open) => !open && closeDeleteFlow()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your account and <strong>all associated data</strong> — employees, shifts, timesheets, and roles. This action <strong>cannot be undone</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteFlow}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFinalDelete}
              disabled={deleteAccountMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-final-delete-account"
            >
              {deleteAccountMutation.isPending ? "Deleting..." : "Yes, delete everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this role? Employees currently assigned this role will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-role"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={empExceptionOpen} onOpenChange={setEmpExceptionOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Per-employee break exception</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={empExceptionId} onValueChange={setEmpExceptionId}>
                <SelectTrigger data-testid="select-exception-employee">
                  <SelectValue placeholder="Select employee…" />
                </SelectTrigger>
                <SelectContent>
                  {breakPolicyEmployees.map(emp => (
                    <SelectItem key={emp.id} value={String(emp.id)}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="exc-paid">Paid break (min)</Label>
                <Input
                  id="exc-paid"
                  type="number"
                  min={0}
                  placeholder="e.g. 30"
                  value={empExceptionPaid}
                  onChange={e => setEmpExceptionPaid(e.target.value)}
                  data-testid="input-exception-paid"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exc-max">Max break (min)</Label>
                <Input
                  id="exc-max"
                  type="number"
                  min={0}
                  placeholder="e.g. 60"
                  value={empExceptionMax}
                  onChange={e => setEmpExceptionMax(e.target.value)}
                  data-testid="input-exception-max"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Leave a field blank to inherit the account-level default for that setting.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmpExceptionOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveEmpException}
              disabled={!empExceptionId || updateEmpExceptionMutation.isPending}
              data-testid="button-save-emp-exception"
            >
              {updateEmpExceptionMutation.isPending ? "Saving…" : "Save exception"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
