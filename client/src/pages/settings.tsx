import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { CustomRole, TimesheetBackup } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings2, Plus, Pencil, Trash2, Check, X, Palette, Coffee, Save, TriangleAlert, ChevronDown, ChevronRight, User, Bell, Database, RotateCcw, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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


export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
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
  const [notifSettings, setNotifSettings] = useState<{
    notifyLate: boolean;
    notifyEarlyClockOut: boolean;
    notifyNotes: boolean;
    notifyApprovals: boolean;
    lateThresholdMinutes: number;
    earlyClockOutThresholdMinutes: number;
  } | null>(null);

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

  const { data: backups = [], isLoading: backupsLoading } = useQuery<Omit<TimesheetBackup, "snapshot">[]>({
    queryKey: ["/api/backups"],
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
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets"] });
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
    <div className="flex flex-col h-full overflow-auto p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Settings2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account preferences</p>
        </div>
      </div>

      <Tabs defaultValue="management" className="w-full">
        <TabsList className="w-full grid grid-cols-2 mb-2">
          <TabsTrigger value="management" data-testid="tab-management">Management</TabsTrigger>
          <TabsTrigger value="account" data-testid="tab-account">Account</TabsTrigger>
        </TabsList>

        {/* ── MANAGEMENT TAB ── */}
        <TabsContent value="management" className="space-y-6 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Coffee className="w-4 h-4 text-amber-600" />
                <div>
                  <CardTitle className="text-base">Break Policy</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Set paid break and recommended maximum break durations
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {policyLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="paid-break" className="text-sm">Paid Break (minutes)</Label>
                      <Input
                        id="paid-break"
                        type="number"
                        min="0"
                        max="480"
                        placeholder="e.g. 30"
                        value={paidBreakInput}
                        onChange={(e) => setPaidBreakInput(e.target.value)}
                        className="h-9"
                        data-testid="input-paid-break"
                      />
                      <p className="text-[11px] text-muted-foreground">Break time included in paid hours</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="max-break" className="text-sm">Max Break (minutes)</Label>
                      <Input
                        id="max-break"
                        type="number"
                        min="0"
                        max="480"
                        placeholder="e.g. 45"
                        value={maxBreakInput}
                        onChange={(e) => setMaxBreakInput(e.target.value)}
                        className="h-9"
                        data-testid="input-max-break"
                      />
                      <p className="text-[11px] text-muted-foreground">Recommended maximum break duration</p>
                    </div>
                  </div>
                  {paidBreakInput !== "" && maxBreakInput !== "" && Number(paidBreakInput) > 0 && (
                    <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
                      Employees get <strong>{paidBreakInput} min</strong> paid break. Any break over <strong>{paidBreakInput} min</strong> will be deducted from worked hours. Recommended maximum is <strong>{maxBreakInput} min</strong>.
                    </div>
                  )}
                  <Button
                    size="sm"
                    onClick={handleSavePolicy}
                    disabled={updatePolicyMutation.isPending}
                    data-testid="button-save-break-policy"
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    {updatePolicyMutation.isPending ? "Saving..." : "Save Policy"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-600" />
                <div>
                  <CardTitle className="text-base">Notifications</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Configure which alerts you receive
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {notifLoading || !notifSettings ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">Late clock-in alerts</Label>
                        <p className="text-[11px] text-muted-foreground">Notify when employees clock in late</p>
                      </div>
                      <Switch
                        checked={notifSettings.notifyLate}
                        onCheckedChange={(v) => {
                          setNotifSettings({ ...notifSettings, notifyLate: v });
                          updateNotifMutation.mutate({ notifyLate: v });
                        }}
                        data-testid="switch-notify-late"
                      />
                    </div>
                    {notifSettings.notifyLate && (
                      <div className="pl-4 border-l-2 border-muted">
                        <Label className="text-xs text-muted-foreground">Threshold (minutes)</Label>
                        <Input
                          type="number"
                          min="1"
                          max="120"
                          value={notifSettings.lateThresholdMinutes}
                          onChange={(e) => setNotifSettings({ ...notifSettings, lateThresholdMinutes: Number(e.target.value) })}
                          onBlur={() => updateNotifMutation.mutate({ lateThresholdMinutes: notifSettings.lateThresholdMinutes })}
                          className="h-8 w-24 mt-1"
                          data-testid="input-late-threshold"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">Early clock-out alerts</Label>
                        <p className="text-[11px] text-muted-foreground">Notify when employees leave early</p>
                      </div>
                      <Switch
                        checked={notifSettings.notifyEarlyClockOut}
                        onCheckedChange={(v) => {
                          setNotifSettings({ ...notifSettings, notifyEarlyClockOut: v });
                          updateNotifMutation.mutate({ notifyEarlyClockOut: v });
                        }}
                        data-testid="switch-notify-early"
                      />
                    </div>
                    {notifSettings.notifyEarlyClockOut && (
                      <div className="pl-4 border-l-2 border-muted">
                        <Label className="text-xs text-muted-foreground">Threshold (minutes)</Label>
                        <Input
                          type="number"
                          min="1"
                          max="120"
                          value={notifSettings.earlyClockOutThresholdMinutes}
                          onChange={(e) => setNotifSettings({ ...notifSettings, earlyClockOutThresholdMinutes: Number(e.target.value) })}
                          onBlur={() => updateNotifMutation.mutate({ earlyClockOutThresholdMinutes: notifSettings.earlyClockOutThresholdMinutes })}
                          className="h-8 w-24 mt-1"
                          data-testid="input-early-threshold"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">Employee notes</Label>
                        <p className="text-[11px] text-muted-foreground">Notify when employees add notes</p>
                      </div>
                      <Switch
                        checked={notifSettings.notifyNotes}
                        onCheckedChange={(v) => {
                          setNotifSettings({ ...notifSettings, notifyNotes: v });
                          updateNotifMutation.mutate({ notifyNotes: v });
                        }}
                        data-testid="switch-notify-notes"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">Approval requests</Label>
                        <p className="text-[11px] text-muted-foreground">Notify when employees request gap-time approval</p>
                      </div>
                      <Switch
                        checked={notifSettings.notifyApprovals}
                        onCheckedChange={(v) => {
                          setNotifSettings({ ...notifSettings, notifyApprovals: v });
                          updateNotifMutation.mutate({ notifyApprovals: v });
                        }}
                        data-testid="switch-notify-approvals"
                      />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-600" />
                  <div>
                    <CardTitle className="text-base">Timesheet Backups</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Restore your timesheet data to a previous state. Backups are created automatically before each CSV import.
                    </CardDescription>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => createBackupMutation.mutate()}
                  disabled={createBackupMutation.isPending}
                  data-testid="button-create-backup"
                >
                  <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                  {createBackupMutation.isPending ? "Saving…" : "Back up now"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {backupsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : backups.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No backups yet. Create one manually or import a CSV.
                </div>
              ) : (
                <div className="space-y-2">
                  {backups.map((backup) => (
                    <div
                      key={backup.id}
                      className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/30"
                      data-testid={`backup-item-${backup.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{backup.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(backup.createdAt!).toLocaleString()} &middot; {backup.entryCount} entries
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => setConfirmRestoreId(backup.id)}
                        disabled={restoreBackupMutation.isPending}
                        data-testid={`button-restore-backup-${backup.id}`}
                      >
                        <RotateCcw className="w-3 h-3" /> Restore
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => deleteBackupMutation.mutate(backup.id)}
                        disabled={deleteBackupMutation.isPending}
                        data-testid={`button-delete-backup-${backup.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  {backups.length >= 10 && (
                    <p className="text-[11px] text-muted-foreground text-center pt-1">Showing the 10 most recent backups</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Employee Roles</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Define roles for your team members
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-xs" data-testid="badge-role-count">
                  {roles.length} roles
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : roles.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No roles yet. Add your first role below.
                </div>
              ) : (
                <div className="space-y-2">
                  {roles.map((role) => (
                    <div
                      key={role.id}
                      className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30"
                      data-testid={`role-item-${role.id}`}
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: role.color || "#8B9E8B" }}
                      />
                      {editingId === role.id ? (
                        <>
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="flex-1 h-8 text-sm"
                            maxLength={40}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            data-testid="input-edit-role"
                          />
                          <label className="relative cursor-pointer" title="Pick color">
                            <div
                              className="h-8 w-8 rounded-md border-2 border-muted-foreground/30 flex items-center justify-center"
                              style={{ backgroundColor: editingColor }}
                            >
                              <Palette className="w-4 h-4 text-white drop-shadow" />
                            </div>
                            <input
                              type="color"
                              value={editingColor}
                              onChange={(e) => setEditingColor(e.target.value)}
                              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                            />
                          </label>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-green-600 hover:text-green-700"
                            onClick={saveEdit}
                            disabled={updateMutation.isPending || !editingName.trim()}
                            data-testid="button-save-role-edit"
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={cancelEdit}
                            data-testid="button-cancel-role-edit"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm font-medium px-1" data-testid={`text-role-name-${role.id}`}>
                            {role.name}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => startEdit(role)}
                            data-testid={`button-edit-role-${role.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeletingId(role.id)}
                            data-testid={`button-delete-role-${role.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(
                <form onSubmit={handleAdd} className="flex gap-2 pt-1">
                  <label className="relative cursor-pointer flex-shrink-0" title="Pick color">
                    <div
                      className="h-9 w-9 rounded-md border-2 border-muted-foreground/30 flex items-center justify-center"
                      style={{ backgroundColor: newRoleColor }}
                    >
                      <Palette className="w-4 h-4 text-white drop-shadow" />
                    </div>
                    <input
                      type="color"
                      value={newRoleColor}
                      onChange={(e) => setNewRoleColor(e.target.value)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                  </label>
                  <Input
                    placeholder="New role name..."
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    maxLength={40}
                    className="flex-1 h-9 text-sm"
                    data-testid="input-new-role"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!newRoleName.trim() || createMutation.isPending}
                    data-testid="button-add-role"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </form>
              )}

            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ACCOUNT TAB ── */}
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
    </div>
  );
}
