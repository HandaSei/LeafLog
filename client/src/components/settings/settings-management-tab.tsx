import type { FormEvent } from "react";
import type { CustomRole, Employee, KioskDevice, TimesheetBackup } from "@shared/schema";
import { RINSE_PLAN_LIMITS } from "@shared/subscription";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Bell, Check, Coffee, Database, Info, Lock, Monitor, Palette, Pencil, Plus, RotateCcw, Save, ShieldCheck, Trash2, Unlock, X } from "lucide-react";

type MutationLike<TVariables> = {
  isPending: boolean;
  mutate: (variables: TVariables) => void;
};

type VoidMutationLike = {
  isPending: boolean;
  mutate: () => void;
};

type NotificationSettings = {
  notifyLate: boolean;
  notifyEarlyClockOut: boolean;
  notifyNotes: boolean;
  notifyApprovals: boolean;
  lateThresholdMinutes: number;
  earlyClockOutThresholdMinutes: number;
  timezone: string;
};

interface SettingsManagementTabProps {
  policyLoading: boolean;
  paidBreakInput: string;
  setPaidBreakInput: (value: string) => void;
  maxBreakInput: string;
  setMaxBreakInput: (value: string) => void;
  updatePolicyMutation: MutationLike<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }>;
  handleSavePolicy: () => void;
  openEmpException: (employee?: Employee) => void;
  employeesWithExceptions: Employee[];
  removeEmpExceptionMutation: MutationLike<number>;
  notifLoading: boolean;
  notifSettings: NotificationSettings | null;
  setNotifSettings: (settings: NotificationSettings) => void;
  updateNotifMutation: MutationLike<Partial<NotificationSettings>>;
  deferredSettingsQueriesEnabled: boolean;
  devicesLoading: boolean;
  kioskDevices: KioskDevice[];
  renamingDeviceId: number | null;
  renameDeviceValue: string;
  setRenameDeviceValue: (value: string) => void;
  setRenamingDeviceId: (id: number | null) => void;
  renameDeviceMutation: MutationLike<{ id: number; deviceName: string }>;
  lockDeviceMutation: MutationLike<{ id: number; isLocked: boolean }>;
  deleteDeviceMutation: MutationLike<number>;
  createBackupMutation: VoidMutationLike;
  backupsLoading: boolean;
  backups: Omit<TimesheetBackup, "snapshot">[];
  isRinsePlan: boolean;
  rinseMaxCustomRoles: number;
  setConfirmRestoreId: (id: number) => void;
  restoreBackupMutation: MutationLike<number>;
  deleteBackupMutation: MutationLike<number>;
  roles: CustomRole[];
  isLoading: boolean;
  editingId: number | null;
  editingName: string;
  setEditingName: (value: string) => void;
  editingColor: string;
  setEditingColor: (value: string) => void;
  saveEdit: () => void;
  cancelEdit: () => void;
  updateMutation: MutationLike<{ id: number; name: string; color: string }>;
  startEdit: (role: CustomRole) => void;
  setDeletingId: (id: number) => void;
  newRoleColor: string;
  setNewRoleColor: (value: string) => void;
  newRoleName: string;
  setNewRoleName: (value: string) => void;
  handleAdd: (event: FormEvent<HTMLFormElement>) => void;
  createMutation: MutationLike<{ name: string; color: string }>;
}

export function SettingsManagementTab({
  policyLoading,
  paidBreakInput,
  setPaidBreakInput,
  maxBreakInput,
  setMaxBreakInput,
  updatePolicyMutation,
  handleSavePolicy,
  openEmpException,
  employeesWithExceptions,
  removeEmpExceptionMutation,
  notifLoading,
  notifSettings,
  setNotifSettings,
  updateNotifMutation,
  deferredSettingsQueriesEnabled,
  devicesLoading,
  kioskDevices,
  renamingDeviceId,
  renameDeviceValue,
  setRenameDeviceValue,
  setRenamingDeviceId,
  renameDeviceMutation,
  lockDeviceMutation,
  deleteDeviceMutation,
  createBackupMutation,
  backupsLoading,
  backups,
  isRinsePlan,
  rinseMaxCustomRoles,
  setConfirmRestoreId,
  restoreBackupMutation,
  deleteBackupMutation,
  roles,
  isLoading,
  editingId,
  editingName,
  setEditingName,
  editingColor,
  setEditingColor,
  saveEdit,
  cancelEdit,
  updateMutation,
  startEdit,
  setDeletingId,
  newRoleColor,
  setNewRoleColor,
  newRoleName,
  setNewRoleName,
  handleAdd,
  createMutation,
}: SettingsManagementTabProps) {
  const roleLimitReached = isRinsePlan && roles.length >= rinseMaxCustomRoles;
  const backupEmptyText = isRinsePlan
    ? "No import backup yet. Rinse creates and keeps one automatic backup before each CSV import."
    : "No backups yet. Create one manually or import a CSV.";

  return (
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

              {/* Per-employee exceptions */}
              <div className="pt-3 border-t mt-2">
                {isRinsePlan ? (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                    Rinse uses the general break policy for everyone. Per-employee exceptions stay saved in the background and will return if the account moves to a higher tier.
                  </div>
                ) : (
                  <>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium">Per-employee exceptions</p>
                    <p className="text-[11px] text-muted-foreground">Override the policy above for specific employees</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openEmpException()} data-testid="button-add-emp-exception">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add exception
                  </Button>
                </div>
                {employeesWithExceptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No exceptions set — all employees use the account policy above.</p>
                ) : (
                  <div className="space-y-1.5">
                    {employeesWithExceptions.map(emp => (
                      <div key={emp.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" data-testid={`emp-exception-${emp.id}`}>
                        <div>
                          <span className="font-medium">{emp.name}</span>
                          {emp.role && emp.role !== "No Role" && (
                            <span className="text-muted-foreground ml-1.5 text-xs">· {emp.role}</span>
                          )}
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {emp.paidBreakMinutes != null ? `${emp.paidBreakMinutes}m paid` : "paid: default"}
                            {" · "}
                            {emp.maxBreakMinutes != null ? `${emp.maxBreakMinutes}m max` : "max: default"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEmpException(emp)} data-testid={`button-edit-exception-${emp.id}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeEmpExceptionMutation.mutate(emp.id)} data-testid={`button-remove-exception-${emp.id}`}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                  </>
                )}
              </div>
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
                <div className="pt-3 border-t">
                  <Label className="text-sm">Timezone</Label>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Used to compute "late" and "early" clock alerts in your local time
                  </p>
                  <Select
                    value={notifSettings.timezone || "UTC"}
                    onValueChange={(v) => {
                      setNotifSettings({ ...notifSettings, timezone: v });
                      updateNotifMutation.mutate({ timezone: v });
                    }}
                  >
                    <SelectTrigger className="h-9 w-full max-w-xs" data-testid="select-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="Europe/Rome">Europe/Rome (Italy)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (UK)</SelectItem>
                      <SelectItem value="Europe/Paris">Europe/Paris (France)</SelectItem>
                      <SelectItem value="Europe/Berlin">Europe/Berlin (Germany)</SelectItem>
                      <SelectItem value="Europe/Madrid">Europe/Madrid (Spain)</SelectItem>
                      <SelectItem value="Europe/Athens">Europe/Athens (Greece)</SelectItem>
                      <SelectItem value="Europe/Bucharest">Europe/Bucharest (Romania)</SelectItem>
                      <SelectItem value="Europe/Warsaw">Europe/Warsaw (Poland)</SelectItem>
                      <SelectItem value="America/New_York">America/New_York</SelectItem>
                      <SelectItem value="America/Chicago">America/Chicago</SelectItem>
                      <SelectItem value="America/Denver">America/Denver</SelectItem>
                      <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
                      <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                      <SelectItem value="Asia/Tokyo">Asia/Tokyo</SelectItem>
                      <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                      <SelectItem value="Asia/Dubai">Asia/Dubai</SelectItem>
                      <SelectItem value="Australia/Sydney">Australia/Sydney</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-violet-600" />
            <div>
              <CardTitle className="text-base">Location Management</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Lock devices to SteepIn mode so employees cannot exit
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30 p-3">
            <Info className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-violet-800 dark:text-violet-300 leading-relaxed">
              When a device enters SteepIn mode it appears here. You can <strong>lock</strong> it so the Exit button disappears — employees will not be able to leave SteepIn mode on that device.
              To unlock it, simply toggle the lock off from this page on any other device. The locked device will update within 30 seconds.
              {isRinsePlan && (
                <span className="block mt-2">
                  Rinse allows one SteepIn device at a time. To use another device, exit SteepIn on the current device or delete it here first.
                </span>
              )}
            </p>
          </div>
          {!deferredSettingsQueriesEnabled ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Loading devices...
            </div>
          ) : devicesLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Updating devices...
            </div>
          ) : kioskDevices.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm italic">
              No devices yet. Enter SteepIn mode on a device and it will appear here.
            </div>
          ) : (
            <div className="space-y-2">
              {kioskDevices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                  data-testid={`device-item-${device.id}`}
                >
                  <Monitor className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {renamingDeviceId === device.id ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={renameDeviceValue}
                          onChange={(e) => setRenameDeviceValue(e.target.value)}
                          className="h-7 text-sm flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameDeviceMutation.mutate({ id: device.id, deviceName: renameDeviceValue });
                            if (e.key === "Escape") { setRenamingDeviceId(null); setRenameDeviceValue(""); }
                          }}
                          data-testid={`input-rename-device-${device.id}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-600"
                          onClick={() => renameDeviceMutation.mutate({ id: device.id, deviceName: renameDeviceValue })}
                          disabled={!renameDeviceValue.trim() || renameDeviceMutation.isPending}
                          data-testid={`button-confirm-rename-device-${device.id}`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => { setRenamingDeviceId(null); setRenameDeviceValue(""); }}
                          data-testid={`button-cancel-rename-device-${device.id}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium truncate" data-testid={`text-device-name-${device.id}`}>{device.deviceName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Last seen {new Date(device.lastSeen!).toLocaleString()}
                          {device.isLocked && (
                            <span className="ml-1.5 text-violet-600 font-medium">· Locked</span>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                  {renamingDeviceId !== device.id && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Rename device"
                        onClick={() => { setRenamingDeviceId(device.id); setRenameDeviceValue(device.deviceName); }}
                        data-testid={`button-rename-device-${device.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className={`h-7 w-7 ${device.isLocked ? "text-violet-600 hover:text-violet-700" : "text-muted-foreground"}`}
                        title={device.isLocked ? "Unlock device" : "Lock device"}
                        onClick={() => lockDeviceMutation.mutate({ id: device.id, isLocked: !device.isLocked })}
                        disabled={lockDeviceMutation.isPending}
                        data-testid={`button-lock-device-${device.id}`}
                      >
                        {device.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Remove device"
                        onClick={() => deleteDeviceMutation.mutate(device.id)}
                        disabled={deleteDeviceMutation.isPending}
                        data-testid={`button-delete-device-${device.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                  {isRinsePlan
                    ? "Rinse keeps the latest automatic CSV-import backup."
                    : "Restore your timesheet data to a previous state. Backups are created automatically before each CSV import."}
                </CardDescription>
              </div>
            </div>
            {isRinsePlan ? (
              <Badge variant="secondary" className="text-xs">Auto only</Badge>
            ) : (
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
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!deferredSettingsQueriesEnabled ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Loading backups...
            </div>
          ) : backupsLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Updating backups...
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              {backupEmptyText}
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
              {isRinsePlan ? `${roles.length}/${rinseMaxCustomRoles} roles` : `${roles.length} roles`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isRinsePlan && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Rinse supports up to {RINSE_PLAN_LIMITS.maxCustomRoles} custom roles. Existing roles can still be edited or deleted.
            </div>
          )}
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
                placeholder={roleLimitReached ? "Role limit reached" : "New role name..."}
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                maxLength={40}
                className="flex-1 h-9 text-sm"
                disabled={roleLimitReached}
                data-testid="input-new-role"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newRoleName.trim() || createMutation.isPending || roleLimitReached}
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
  );
}
