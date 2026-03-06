import { useState, useMemo, useEffect, useCallback, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { format } from "date-fns";
import type { Employee, TimeEntry } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmployeeAvatar } from "@/components/employee-avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Clock, LogIn, LogOut, Coffee, ArrowLeft, Search, Timer, CheckCircle2, Info, Delete, StickyNote,
  Fingerprint, Sparkles, UserCheck
} from "lucide-react";
import { cn } from "@/lib/utils";

// Animated counter for smooth number transitions
function AnimatedDigit({ digit, delay = 0 }: { digit: string; delay?: number }) {
  return (
    <span 
      className="inline-block animate-in zoom-in-50 duration-200"
      style={{ animationDelay: `${delay}ms` }}
    >
      {digit}
    </span>
  );
}

// Modern PinPad with progressive reveal
interface PinPadProps {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  isVerifying?: boolean;
}

const PinPad = memo(function PinPad({ value, onChange, maxLength = 6, isVerifying }: PinPadProps) {
  const press = useCallback((d: string) => {
    if (value.length < maxLength) onChange(value + d);
  }, [value, maxLength, onChange]);

  const back = useCallback(() => onChange(value.slice(0, -1)), [value, onChange]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isVerifying) return;
      if (e.key >= '0' && e.key <= '9') {
        if (value.length < maxLength) onChange(value + e.key);
      } else if (e.key === 'Backspace') {
        onChange(value.slice(0, -1));
      } else if (e.key === 'Enter' && value.length >= 4) {
        // Allow form submission via enter
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [value, maxLength, onChange, isVerifying]);

  return (
    <div className="flex flex-col items-center gap-6 py-2 select-none">
      {/* Progressive dot display - only show dots for entered digits */}
      <div className="flex gap-3 min-h-[20px]">
        {value.length > 0 && (
          <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {Array.from({ length: value.length }, (_, i) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full bg-primary shadow-sm animate-in zoom-in-50 duration-200"
                style={{ animationDelay: `${i * 30}ms` }}
              />
            ))}
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-3 gap-3">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            disabled={isVerifying}
            className={cn(
              "w-[72px] h-[60px] rounded-2xl text-xl font-semibold transition-all duration-150",
              "bg-card border-2 border-border/50 shadow-sm",
              "hover:border-primary/50 hover:shadow-md hover:scale-[1.02]",
              "active:scale-95 active:shadow-inner",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {d}
          </button>
        ))}
        <div className="w-[72px] h-[60px]" />
        <button
          type="button"
          onClick={() => press("0")}
          disabled={isVerifying}
          className={cn(
            "w-[72px] h-[60px] rounded-2xl text-xl font-semibold transition-all duration-150",
            "bg-card border-2 border-border/50 shadow-sm",
            "hover:border-primary/50 hover:shadow-md hover:scale-[1.02]",
            "active:scale-95 active:shadow-inner",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          0
        </button>
        <button
          type="button"
          onClick={back}
          disabled={isVerifying || value.length === 0}
          className={cn(
            "w-[72px] h-[60px] rounded-2xl transition-all duration-150",
            "bg-muted border-2 border-border/50 shadow-sm",
            "hover:bg-muted/80 hover:shadow-md",
            "active:scale-95 active:shadow-inner",
            "disabled:opacity-30 disabled:cursor-not-allowed",
            "flex items-center justify-center"
          )}
        >
          <Delete className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
});

interface BreakPolicy {
  paidBreakMinutes: number | null;
  maxBreakMinutes: number | null;
}

type ActionType = "clock-in" | "clock-out" | "break-start" | "break-end";

// Action button with animations and visual feedback
interface ActionButtonProps {
  type: ActionType;
  onClick: () => void;
  disabled: boolean;
  isLoading?: boolean;
  currentStatus?: string;
}

const ActionButton = memo(function ActionButton({ 
  type, onClick, disabled, isLoading, currentStatus 
}: ActionButtonProps) {
  const configs: Record<ActionType, {
    icon: React.ReactNode;
    label: string;
    sublabel: string;
    gradient: string;
    shadowColor: string;
    iconBg: string;
  }> = {
    "clock-in": {
      icon: <LogIn className="w-7 h-7" />,
      label: "Clock In",
      sublabel: "Start your shift",
      gradient: "from-emerald-500 to-teal-600",
      shadowColor: "shadow-emerald-500/30",
      iconBg: "bg-emerald-400/20",
    },
    "clock-out": {
      icon: <LogOut className="w-7 h-7" />,
      label: "Clock Out",
      sublabel: "End your shift",
      gradient: "from-rose-500 to-pink-600",
      shadowColor: "shadow-rose-500/30",
      iconBg: "bg-rose-400/20",
    },
    "break-start": {
      icon: <Coffee className="w-7 h-7" />,
      label: "Start Break",
      sublabel: "Take a break",
      gradient: "from-amber-500 to-orange-600",
      shadowColor: "shadow-amber-500/30",
      iconBg: "bg-amber-400/20",
    },
    "break-end": {
      icon: <Timer className="w-7 h-7" />,
      label: "End Break",
      sublabel: "Resume work",
      gradient: "from-blue-500 to-indigo-600",
      shadowColor: "shadow-blue-500/30",
      iconBg: "bg-blue-400/20",
    },
  };

  const config = configs[type];
  const isActive = !disabled && !isLoading;

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn(
        "relative overflow-hidden rounded-2xl p-4 transition-all duration-300",
        "flex flex-col items-center gap-2 text-white",
        "bg-gradient-to-br",
        config.gradient,
        config.shadowColor,
        isActive && "shadow-lg hover:shadow-xl hover:scale-[1.02] hover:-translate-y-0.5",
        isActive && "active:scale-95 active:translate-y-0",
        disabled && "opacity-40 grayscale cursor-not-allowed"
      )}
    >
      {/* Shine effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      {/* Icon container */}
      <div className={cn(
        "relative flex items-center justify-center w-14 h-14 rounded-xl",
        config.iconBg,
        "backdrop-blur-sm"
      )}>
        {config.icon}
      </div>
      
      {/* Text */}
      <div className="relative text-center">
        <div className="font-semibold text-sm">{config.label}</div>
        <div className="text-[10px] text-white/80">{config.sublabel}</div>
      </div>

      {/* Active indicator pulse */}
      {isActive && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-white/60 animate-pulse" />
      )}
    </button>
  );
});

// Time display component - memoized to prevent re-renders
const TimeDisplay = memo(function TimeDisplay() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono bg-muted/50 px-3 py-1.5 rounded-full">
      <Clock className="w-3.5 h-3.5" />
      <span>{format(time, "HH:mm:ss")}</span>
    </div>
  );
});

// Employee card for the grid
const EmployeeCard = memo(function EmployeeCard({ 
  employee, onClick 
}: { 
  employee: Employee; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-center gap-3 p-5 rounded-2xl",
        "bg-card border-2 border-border/40",
        "transition-all duration-300 ease-out",
        "hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
        "hover:-translate-y-1 hover:scale-[1.02]",
        "active:scale-[0.98] active:translate-y-0"
      )}
    >
      {/* Hover glow effect */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="relative">
        <EmployeeAvatar name={employee.name} color={employee.color} size="lg" />
        {/* Selection indicator */}
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 scale-50 group-hover:scale-100">
          <UserCheck className="w-3 h-3" />
        </div>
      </div>
      
      <div className="relative text-center">
        <div className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
          {employee.name}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {employee.role || "Team Member"}
        </div>
      </div>
    </button>
  );
});

// Success animation overlay
function SuccessOverlay({ 
  isVisible, 
  action,
  employeeName 
}: { 
  isVisible: boolean; 
  action: ActionType | null;
  employeeName: string;
}) {
  if (!isVisible || !action) return null;

  const configs: Record<ActionType, { icon: React.ReactNode; color: string; label: string }> = {
    "clock-in": { 
      icon: <LogIn className="w-8 h-8" />, 
      color: "text-emerald-500",
      label: "Clocked In" 
    },
    "clock-out": { 
      icon: <LogOut className="w-8 h-8" />, 
      color: "text-rose-500",
      label: "Clocked Out" 
    },
    "break-start": { 
      icon: <Coffee className="w-8 h-8" />, 
      color: "text-amber-500",
      label: "Break Started" 
    },
    "break-end": { 
      icon: <Timer className="w-8 h-8" />, 
      color: "text-blue-500",
      label: "Break Ended" 
    },
  };

  const config = configs[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
        <div className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center",
          "bg-card border-2 border-border shadow-xl",
          config.color
        )}>
          {config.icon}
        </div>
        <div className="text-center">
          <div className="text-xl font-bold">{config.label}</div>
          <div className="text-sm text-muted-foreground">{employeeName}</div>
          <div className="text-lg font-mono mt-1">{format(new Date(), "HH:mm")}</div>
        </div>
      </div>
    </div>
  );
}

export default function SteepInPage() {
  const { data: authState, isLoading: authLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const { exitSteepIn } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [passcode, setPasscode] = useState("");
  const [passcodeDialogOpen, setPasscodeDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitUsername, setExitUsername] = useState("");
  const [exitPassword, setExitPassword] = useState("");
  const [noteText, setNoteText] = useState("");
  const [reClockData, setReClockData] = useState<{ lastClockOutTime: string; lastClockOutId: number; lastClockOutDate: string; minutesSince: number } | null>(null);
  const [reClockDialogOpen, setReClockDialogOpen] = useState(false);
  const [reClockPasscode, setReClockPasscode] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const { toast } = useToast();

  const user = authState?.user;
  const isActive = !!authState?.authenticated && !!authState?.steepinMode;

  // Optimized queries with better caching
  const { data: employees, isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/steepin/employees"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/steepin/employees");
      if (!res.ok) throw new Error("Failed to fetch employees");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: isActive,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/steepin/entries", selectedEmployee?.id?.toString() || ""],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isActive && !!selectedEmployee,
    staleTime: 30 * 1000, // 30 seconds
  });

  const { data: breakPolicy } = useQuery<BreakPolicy>({
    queryKey: ["/api/settings/break-policy"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isActive,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!authLoading && !isActive) {
      setLocation("/login");
    }
  }, [authLoading, isActive, setLocation]);

  const actionMutation = useMutation({
    mutationFn: async ({ employeeId, type, passcode, notes, reClockAction, skipReClockCheck }: { employeeId: number; type: ActionType; passcode: string; notes?: string; reClockAction?: string; skipReClockCheck?: boolean }) => {
      const res = await apiRequest("POST", "/api/steepin/action", { employeeId, type, passcode, notes: notes || undefined, reClockAction, skipReClockCheck });
      return res.json();
    },
    onSuccess: (data, variables) => {
      if (data.reClockDetected) {
        setReClockData(data);
        setReClockPasscode(variables.passcode);
        setPasscodeDialogOpen(false);
        setPasscode("");
        setReClockDialogOpen(true);
        return;
      }
      if (data.reClockHandled) {
        queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries", variables.employeeId.toString()] });
        toast({ title: "Shift Resumed", description: `Gap handled as "${data.action === 'break' ? 'break' : 'working time'}" — awaiting manager approval.` });
        setReClockDialogOpen(false);
        setReClockData(null);
        setReClockPasscode("");
        setNoteText("");
        setPendingAction(null);
        return;
      }
      
      // Show success animation
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1500);
      
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries", variables.employeeId.toString()] });
      const labels: Record<ActionType, string> = {
        "clock-in": "Clocked In",
        "clock-out": "Clocked Out",
        "break-start": "Break Started",
        "break-end": "Break Ended",
      };
      toast({ title: labels[variables.type], description: `${selectedEmployee?.name} - ${format(new Date(), "HH:mm")}` });
      setPasscode("");
      setPasscodeDialogOpen(false);
      setPendingAction(null);
      setNoteText("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setPasscode("");
    },
  });

  const exitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/steepin-exit", { 
        username: exitUsername, 
        password: exitPassword 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setExitDialogOpen(false);
      setExitUsername("");
      setExitPassword("");
      toast({ title: "SteepIn Exited", description: "Successfully deactivated SteepIn mode" });
      setLocation("/login");
    },
    onError: (err: Error) => {
      toast({ title: "Exit Failed", description: err.message, variant: "destructive" });
    }
  });

  const currentShiftEntries = useMemo(() => {
    if (!entries.length) return [];
    let lastClockInIndex = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === "clock-in") {
        lastClockInIndex = i;
        break;
      }
    }
    if (lastClockInIndex === -1) return [];
    return entries.slice(lastClockInIndex);
  }, [entries]);

  const currentStatus = useMemo(() => {
    if (!entries.length) return "not-started";
    const last = entries[entries.length - 1];
    return last.type;
  }, [entries]);

  const filteredEmployees = useMemo(() => {
    if (!employees || !Array.isArray(employees)) return [];
    const query = searchQuery.toLowerCase().trim();
    if (!query) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(query) ||
        (e.role && e.role.toLowerCase().includes(query))
    );
  }, [employees, searchQuery]);

  if (authLoading || !isActive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 animate-pulse" />
          <Skeleton className="w-48 h-4 rounded-full" />
        </div>
      </div>
    );
  }

  const handleAction = useCallback((type: ActionType) => {
    if (!selectedEmployee) return;
    setPendingAction(type);
    setPasscodeDialogOpen(true);
  }, [selectedEmployee]);

  const submitPasscode = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !pendingAction || passcode.length < 4 || passcode.length > 6) return;
    actionMutation.mutate({ employeeId: selectedEmployee.id, type: pendingAction, passcode, notes: noteText.trim() || undefined });
  }, [selectedEmployee, pendingAction, passcode, noteText, actionMutation]);

  const handleReClockChoice = useCallback((action: "new-shift" | "break" | "working") => {
    if (!selectedEmployee || !reClockData) return;
    if (action === "new-shift") {
      actionMutation.mutate({ employeeId: selectedEmployee.id, type: "clock-in", passcode: reClockPasscode, skipReClockCheck: true, notes: noteText.trim() || undefined });
      setReClockDialogOpen(false);
      setReClockData(null);
      setReClockPasscode("");
    } else {
      actionMutation.mutate({ employeeId: selectedEmployee.id, type: "clock-in", passcode: reClockPasscode, reClockAction: action });
    }
  }, [selectedEmployee, reClockData, reClockPasscode, noteText, actionMutation]);

  const handleExitSteepIn = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    exitMutation.mutate();
  }, [exitMutation]);

  const handleBack = useCallback(() => {
    setSelectedEmployee(null);
    setPasscode("");
    setNoteText("");
  }, []);

  // Employee selection view
  if (selectedEmployee) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 p-4 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-2 hover:bg-muted"
            data-testid="button-steepin-back"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          
          <TimeDisplay />
          
          <div className="w-[70px]" />
        </header>

        {/* Main content */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6">
            {/* Employee header card */}
            <div className="text-center space-y-4">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                <EmployeeAvatar name={selectedEmployee.name} color={selectedEmployee.color} size="lg" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                  <Fingerprint className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold" data-testid="text-steepin-employee-name">
                  {selectedEmployee.name}
                </h2>
                <p className="text-sm text-muted-foreground">{selectedEmployee.role || "Team Member"}</p>
              </div>
              
              {/* Status badge */}
              <div className={cn(
                "inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium",
                currentStatus === "clock-in" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                currentStatus === "break-start" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                currentStatus === "clock-out" && "bg-muted text-muted-foreground",
                currentStatus === "not-started" && "bg-muted text-muted-foreground"
              )}>
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  currentStatus === "clock-in" && "bg-emerald-500 animate-pulse",
                  currentStatus === "break-start" && "bg-amber-500 animate-pulse",
                  (currentStatus === "clock-out" || currentStatus === "not-started") && "bg-muted-foreground"
                )} />
                {currentStatus === "clock-in" && "Currently Working"}
                {currentStatus === "break-start" && "On Break"}
                {currentStatus === "clock-out" && "Clocked Out"}
                {currentStatus === "not-started" && "Not Started"}
              </div>
            </div>

            {/* Action buttons grid */}
            {entriesLoading ? (
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-28 rounded-2xl" />
                <Skeleton className="h-28 rounded-2xl" />
                <Skeleton className="h-28 rounded-2xl" />
                <Skeleton className="h-28 rounded-2xl" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <ActionButton
                  type="clock-in"
                  onClick={() => handleAction("clock-in")}
                  disabled={currentStatus === "clock-in" || currentStatus === "break-start" || actionMutation.isPending}
                  isLoading={actionMutation.isPending && pendingAction === "clock-in"}
                  currentStatus={currentStatus}
                />
                <ActionButton
                  type="clock-out"
                  onClick={() => handleAction("clock-out")}
                  disabled={(currentStatus !== "clock-in" && currentStatus !== "break-end") || actionMutation.isPending}
                  isLoading={actionMutation.isPending && pendingAction === "clock-out"}
                  currentStatus={currentStatus}
                />
                <ActionButton
                  type="break-start"
                  onClick={() => handleAction("break-start")}
                  disabled={(currentStatus !== "clock-in" && currentStatus !== "break-end") || actionMutation.isPending}
                  isLoading={actionMutation.isPending && pendingAction === "break-start"}
                  currentStatus={currentStatus}
                />
                <ActionButton
                  type="break-end"
                  onClick={() => handleAction("break-end")}
                  disabled={currentStatus !== "break-start" || actionMutation.isPending}
                  isLoading={actionMutation.isPending && pendingAction === "break-end"}
                  currentStatus={currentStatus}
                />
              </div>
            )}

            {/* Current shift timeline */}
            {currentShiftEntries.length > 0 && (
              <Card className="p-5 border-2 border-border/40">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">Current Shift</h3>
                </div>
                <div className="space-y-3">
                  {currentShiftEntries.map((entry, index) => {
                    const typeLabels: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
                      "clock-in": { label: "Clock In", color: "#10B981", icon: <LogIn className="w-3 h-3" /> },
                      "clock-out": { label: "Clock Out", color: "#EF4444", icon: <LogOut className="w-3 h-3" /> },
                      "break-start": { label: "Break Start", color: "#F59E0B", icon: <Coffee className="w-3 h-3" /> },
                      "break-end": { label: "Break End", color: "#3B82F6", icon: <Timer className="w-3 h-3" /> },
                    };
                    const info = typeLabels[entry.type] || { label: entry.type, color: "#6B7280", icon: <Clock className="w-3 h-3" /> };
                    const isLast = index === currentShiftEntries.length - 1;
                    return (
                      <div key={entry.id} className="flex items-center gap-3" data-testid={`time-entry-${entry.id}`}>
                        <div className="relative flex flex-col items-center">
                          <div 
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                            style={{ backgroundColor: info.color }}
                          >
                            {info.icon}
                          </div>
                          {!isLast && (
                            <div className="w-0.5 h-6 bg-border mt-1" />
                          )}
                        </div>
                        <div className="flex-1 flex items-center justify-between">
                          <span className="text-sm font-medium">{info.label}</span>
                          <span className="text-sm text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded">
                            {format(new Date(entry.timestamp), "HH:mm")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Success overlay */}
        <SuccessOverlay 
          isVisible={showSuccess} 
          action={pendingAction} 
          employeeName={selectedEmployee.name} 
        />

        {/* Passcode dialog */}
        <Dialog open={passcodeDialogOpen} onOpenChange={(open) => {
          if (!actionMutation.isPending) {
            setPasscodeDialogOpen(open);
            if (!open) {
              setPasscode("");
              setNoteText("");
            }
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Fingerprint className="w-5 h-5 text-primary" />
                Enter Passcode
              </DialogTitle>
              <DialogDescription>
                Enter your 4-6 digit passcode to confirm
              </DialogDescription>
            </DialogHeader>
            
            {pendingAction === "break-start" && (breakPolicy?.paidBreakMinutes || breakPolicy?.maxBreakMinutes) && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <Info className="w-4 h-4" />
                  Break Policy
                </div>
                {breakPolicy.paidBreakMinutes != null && breakPolicy.paidBreakMinutes > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Paid break: <strong>{breakPolicy.paidBreakMinutes} min</strong>
                  </p>
                )}
                {breakPolicy.maxBreakMinutes != null && breakPolicy.maxBreakMinutes > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Maximum: <strong>{breakPolicy.maxBreakMinutes} min</strong>
                  </p>
                )}
              </div>
            )}
            
            <form onSubmit={submitPasscode} className="space-y-4">
              <PinPad 
                value={passcode} 
                onChange={setPasscode} 
                maxLength={6} 
                isVerifying={actionMutation.isPending}
              />
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StickyNote className="w-3.5 h-3.5" />
                  <span>Add a note (optional)</span>
                </div>
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="e.g. covering for Alex, running late..."
                  className="h-16 text-sm resize-none rounded-xl"
                  maxLength={200}
                  data-testid="input-steepin-note"
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setPasscodeDialogOpen(false); setNoteText(""); setPasscode(""); }}
                  disabled={actionMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={passcode.length < 4 || actionMutation.isPending}
                  className="gap-2"
                >
                  {actionMutation.isPending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm
                    </>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ReClock dialog */}
        <Dialog open={reClockDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setReClockDialogOpen(false);
            setReClockData(null);
            setReClockPasscode("");
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Welcome Back
              </DialogTitle>
              <DialogDescription>
                You clocked out {reClockData?.minutesSince} minutes ago. What would you like to do?
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <button
                className={cn(
                  "w-full p-4 rounded-xl border-2 border-border/50 text-left transition-all duration-200",
                  "hover:border-primary/50 hover:bg-primary/5 hover:shadow-md",
                  "active:scale-[0.98]",
                  actionMutation.isPending && "opacity-50 cursor-not-allowed"
                )}
                onClick={() => handleReClockChoice("new-shift")}
                disabled={actionMutation.isPending}
                data-testid="button-reclock-new-shift"
              >
                <div className="font-semibold text-sm mb-1">Start a New Shift</div>
                <div className="text-xs text-muted-foreground">Begin a fresh shift (default)</div>
              </button>
              <button
                className={cn(
                  "w-full p-4 rounded-xl border-2 border-border/50 text-left transition-all duration-200",
                  "hover:border-amber-500/50 hover:bg-amber-500/5 hover:shadow-md",
                  "active:scale-[0.98]",
                  actionMutation.isPending && "opacity-50 cursor-not-allowed"
                )}
                onClick={() => handleReClockChoice("break")}
                disabled={actionMutation.isPending}
                data-testid="button-reclock-break"
              >
                <div className="font-semibold text-sm mb-1">I Was on a Break</div>
                <div className="text-xs text-muted-foreground">Count the gap as break time (needs approval)</div>
              </button>
              <button
                className={cn(
                  "w-full p-4 rounded-xl border-2 border-border/50 text-left transition-all duration-200",
                  "hover:border-blue-500/50 hover:bg-blue-500/5 hover:shadow-md",
                  "active:scale-[0.98]",
                  actionMutation.isPending && "opacity-50 cursor-not-allowed"
                )}
                onClick={() => handleReClockChoice("working")}
                disabled={actionMutation.isPending}
                data-testid="button-reclock-working"
              >
                <div className="font-semibold text-sm mb-1">I Was Still Working</div>
                <div className="text-xs text-muted-foreground">Count the gap as working time (needs approval)</div>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Employee list view
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 p-4 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/20">
            <Clock className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-bold">SteepIn</h1>
            <p className="text-[11px] text-muted-foreground">Select your name to clock in/out</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExitDialogOpen(true)}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          data-testid="button-exit-steepin-list"
        >
          Exit
        </Button>
      </header>

      {/* Exit dialog */}
      <Dialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="w-5 h-5 text-muted-foreground" />
              Exit SteepIn
            </DialogTitle>
            <DialogDescription>
              Manager credentials are required to deactivate SteepIn mode.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleExitSteepIn} className="space-y-4" autoComplete="off" data-form-type="other">
            <input type="text" name="trap_usr2" tabIndex={-1} autoComplete="username" className="sr-only" aria-hidden="true" />
            <input type="password" name="trap_pw2" tabIndex={-1} autoComplete="current-password" className="sr-only" aria-hidden="true" />
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input
                name={`mgr_id_${Date.now()}`}
                value={exitUsername}
                onChange={(e) => setExitUsername(e.target.value)}
                placeholder="Manager username"
                required
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore=""
                data-bwignore=""
                data-form-type="other"
                onFocus={(e) => { e.target.removeAttribute("readonly"); }}
                readOnly
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                name={`mgr_key_${Date.now()}`}
                value={exitPassword}
                onChange={(e) => setExitPassword(e.target.value)}
                placeholder="Manager password"
                required
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore=""
                data-bwignore=""
                data-form-type="other"
                onFocus={(e) => { e.target.removeAttribute("readonly"); }}
                readOnly
                className="rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setExitDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={exitMutation.isPending}
                variant="destructive"
              >
                {exitMutation.isPending ? "Exiting..." : "Exit SteepIn"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Search */}
      <div className="p-4 border-b bg-muted/30">
        <div className="relative max-w-md mx-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 rounded-xl border-2 h-11"
            data-testid="input-steepin-search"
          />
        </div>
      </div>

      {/* Employee grid */}
      <div className="flex-1 overflow-auto p-4">
        {empsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground">No employees found</p>
            {searchQuery && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setSearchQuery("")}
                className="mt-2"
              >
                Clear search
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {filteredEmployees.map((emp) => (
              <EmployeeCard
                key={emp.id}
                employee={emp}
                onClick={() => setSelectedEmployee(emp)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
