import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { DollarSign, Calendar, X, Plus, AlertTriangle } from "lucide-react";
import { format, parse } from "date-fns";

interface PayConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface CustomPayDay {
  date: string;
  rate: string;
}

export function PayConfigDialog({ open, onOpenChange, employee }: PayConfigDialogProps) {
  const { toast } = useToast();
  const [hourlyRate, setHourlyRate] = useState("");
  const [tierEnabled, setTierEnabled] = useState(false);
  const [tierThresholdOnly, setTierThresholdOnly] = useState(false);
  const [tierHoursThreshold, setTierHoursThreshold] = useState("");
  const [tierOvertimeRate, setTierOvertimeRate] = useState("");
  const [specialDayEnabled, setSpecialDayEnabled] = useState(false);
  const [specialDayOfWeek, setSpecialDayOfWeek] = useState("0");
  const [specialDayRate, setSpecialDayRate] = useState("");
  const [customPayDays, setCustomPayDays] = useState<CustomPayDay[]>([]);
  const [newCustomDate, setNewCustomDate] = useState("");
  const [newCustomRate, setNewCustomRate] = useState("");

  useEffect(() => {
    if (open && employee) {
      setHourlyRate(employee.hourlyRate ?? "");
      setTierEnabled(employee.tierEnabled ?? false);
      setTierThresholdOnly(employee.tierThresholdOnly ?? false);
      setTierHoursThreshold(employee.tierHoursThreshold?.toString() ?? "");
      setTierOvertimeRate(employee.tierOvertimeRate ?? "");
      setSpecialDayEnabled(employee.specialDayEnabled ?? false);
      setSpecialDayOfWeek(employee.specialDayOfWeek?.toString() ?? "0");
      setSpecialDayRate(employee.specialDayRate ?? "");
      try {
        const parsed = employee.customPayDays ? JSON.parse(employee.customPayDays) : [];
        setCustomPayDays(Array.isArray(parsed) ? parsed : []);
      } catch {
        setCustomPayDays([]);
      }
    }
  }, [open, employee]);

  const mutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      return apiRequest("PATCH", `/api/employees/${employee!.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Pay configuration saved", description: `Updated pay settings for ${employee?.name}.` });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const data: Record<string, any> = {
      hourlyRate: (!tierThresholdOnly && hourlyRate) ? hourlyRate : (tierThresholdOnly ? null : null),
      tierEnabled,
      tierThresholdOnly: tierEnabled ? tierThresholdOnly : false,
      tierHoursThreshold: tierEnabled && tierHoursThreshold ? parseInt(tierHoursThreshold) : null,
      tierOvertimeRate: tierEnabled && tierOvertimeRate ? tierOvertimeRate : null,
      specialDayEnabled,
      specialDayOfWeek: specialDayEnabled ? parseInt(specialDayOfWeek) : null,
      specialDayRate: specialDayEnabled && specialDayRate ? specialDayRate : null,
      customPayDays: customPayDays.length > 0 ? JSON.stringify(customPayDays) : null,
    };
    if (!tierThresholdOnly && hourlyRate) {
      data.hourlyRate = hourlyRate;
    } else if (tierThresholdOnly) {
      data.hourlyRate = null;
    } else {
      data.hourlyRate = hourlyRate || null;
    }
    mutation.mutate(data);
  };

  const addCustomDay = () => {
    if (!newCustomDate || !newCustomRate) return;
    if (customPayDays.some(d => d.date === newCustomDate)) {
      toast({ title: "Duplicate date", description: "This date already has a custom rate.", variant: "destructive" });
      return;
    }
    setCustomPayDays(prev => [...prev, { date: newCustomDate, rate: newCustomRate }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewCustomDate("");
    setNewCustomRate("");
  };

  const removeCustomDay = (date: string) => {
    setCustomPayDays(prev => prev.filter(d => d.date !== date));
  };

  if (!employee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-pay-config-title">
            <DollarSign className="w-5 h-5 text-primary" />
            Pay Configuration
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{employee.name} &middot; {employee.role || "No role"}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">

          {!tierThresholdOnly && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Base Hourly Rate</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  className="pl-7"
                  data-testid="input-hourly-rate"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">/hour</span>
              </div>
            </div>
          )}

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Tiered Pay</p>
                <p className="text-[11px] text-muted-foreground">Different rate after weekly hour threshold</p>
              </div>
              <Switch
                checked={tierEnabled}
                onCheckedChange={(v) => {
                  setTierEnabled(v);
                  if (!v) setTierThresholdOnly(false);
                }}
                data-testid="toggle-tier-enabled"
              />
            </div>
            {tierEnabled && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Hours threshold / week</Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="40"
                      value={tierHoursThreshold}
                      onChange={(e) => setTierHoursThreshold(e.target.value)}
                      data-testid="input-tier-threshold"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Secondary Rate</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={tierOvertimeRate}
                        onChange={(e) => setTierOvertimeRate(e.target.value)}
                        className="pl-7"
                        data-testid="input-tier-overtime-rate"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/30">
                  <div>
                    <p className="text-xs font-medium">Secondary Rate</p>
                    <p className="text-[10px] text-muted-foreground">Only count hours after threshold</p>
                  </div>
                  <Switch
                    checked={tierThresholdOnly}
                    onCheckedChange={setTierThresholdOnly}
                    data-testid="toggle-threshold-only"
                  />
                </div>

                {tierThresholdOnly && (
                  <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-[11px] text-amber-800 dark:text-amber-200">
                      <strong>Secondary rate only mode is active.</strong> Only hours worked beyond the {tierHoursThreshold || "?"}-hour weekly threshold will be paid at the Secondary Rate (${tierOvertimeRate || "0"}/h). Hours within the threshold are not paid.
                    </AlertDescription>
                  </Alert>
                )}

                {!tierThresholdOnly && hourlyRate && tierOvertimeRate && (
                  <p className="text-[10px] text-muted-foreground">
                    First {tierHoursThreshold || "?"} hours at ${hourlyRate}/h, then ${tierOvertimeRate}/h
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Special Day Rate</p>
                <p className="text-[11px] text-muted-foreground">Higher rate on a specific day of the week</p>
              </div>
              <Switch
                checked={specialDayEnabled}
                onCheckedChange={setSpecialDayEnabled}
                data-testid="toggle-special-day-enabled"
              />
            </div>
            {specialDayEnabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Day of week</Label>
                    <Select value={specialDayOfWeek} onValueChange={setSpecialDayOfWeek}>
                      <SelectTrigger data-testid="select-special-day">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((day, i) => (
                          <SelectItem key={i} value={String(i)}>{day}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Rate for this day</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={specialDayRate}
                        onChange={(e) => setSpecialDayRate(e.target.value)}
                        className="pl-7"
                        data-testid="input-special-day-rate"
                      />
                    </div>
                  </div>
                </div>
                {tierThresholdOnly && (
                  <Alert className="border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-[11px] text-red-800 dark:text-red-200">
                      <strong>Secondary rate only mode is enabled.</strong> Special Day rates will be counted as post-threshold hours since only hours after the threshold are paid.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <p className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Custom Date Rates
              </p>
              <p className="text-[11px] text-muted-foreground">Set custom rates for specific calendar dates</p>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    type="date"
                    value={newCustomDate}
                    onChange={(e) => setNewCustomDate(e.target.value)}
                    className="text-xs"
                    data-testid="input-custom-date"
                  />
                </div>
                <div className="relative w-24">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={newCustomRate}
                    onChange={(e) => setNewCustomRate(e.target.value)}
                    className="pl-6 text-xs"
                    data-testid="input-custom-rate"
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  onClick={addCustomDay}
                  disabled={!newCustomDate || !newCustomRate}
                  data-testid="button-add-custom-day"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {tierThresholdOnly && customPayDays.length > 0 && (
                <Alert className="border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-[11px] text-red-800 dark:text-red-200">
                    <strong>Secondary rate only mode is enabled.</strong> Custom Date rates will be counted as post-threshold hours since only hours after the threshold are paid.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            {customPayDays.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {customPayDays.map((day) => (
                  <div key={day.date} className="flex items-center justify-between py-1 px-2 rounded-sm bg-muted/50 text-xs">
                    <span className="font-medium">
                      {(() => {
                        try {
                          return format(parse(day.date, "yyyy-MM-dd", new Date()), "MMM d, yyyy");
                        } catch {
                          return day.date;
                        }
                      })()}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">${day.rate}/h</Badge>
                      <button
                        onClick={() => removeCustomDay(day.date)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        data-testid={`button-remove-custom-${day.date}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="w-full sm:w-auto px-8"
            data-testid="button-save-pay-config"
          >
            {mutation.isPending ? "Saving..." : "Save Pay Settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
