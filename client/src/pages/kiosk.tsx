import { useState, useMemo, useEffect } from "react";
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
import {
  Clock, LogIn, LogOut, Coffee, ArrowLeft, Search, Timer, CheckCircle2,
} from "lucide-react";

type ActionType = "clock-in" | "clock-out" | "break-start" | "break-end";

export default function KioskPage() {
  const { user, isLoading: authLoading, isSteepIn, exitSteepIn } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [passcode, setPasscode] = useState("");
  const [passcodeDialogOpen, setPasscodeDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const { toast } = useToast();

  const isActive = !!user && isSteepIn;

  useEffect(() => {
    if (!authLoading && !isActive) {
      setLocation("/login");
    }
  }, [authLoading, isActive, setLocation]);

  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/kiosk/employees"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isActive,
    staleTime: Infinity,
  });

  const { data: entries = [] } = useQuery<TimeEntry[]>({
    queryKey: ["/api/kiosk/entries", selectedEmployee?.id?.toString() || ""],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isActive && !!selectedEmployee,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ employeeId, type, passcode }: { employeeId: number; type: ActionType; passcode: string }) => {
      const res = await apiRequest("POST", "/api/kiosk/action", { employeeId, type, passcode });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk/entries", variables.employeeId.toString()] });
      const labels: Record<ActionType, string> = {
        "clock-in": "Clocked In",
        "clock-out": "Clocked Out",
        "break-start": "Break Started",
        "break-end": "Break Ended",
      };
      toast({ title: labels[variables.type], description: `${selectedEmployee?.name} - ${format(new Date(), "h:mm a")}` });
      setPasscode("");
      setPasscodeDialogOpen(false);
      setPendingAction(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setPasscode("");
    },
  });

  const currentStatus = useMemo(() => {
    if (!entries.length) return "not-started";
    const last = entries[entries.length - 1];
    return last.type;
  }, [entries]);

  const statusInfo = useMemo(() => {
    switch (currentStatus) {
      case "clock-in":
        return { label: "Working", color: "#10B981", icon: CheckCircle2 };
      case "break-start":
        return { label: "On Break", color: "#F59E0B", icon: Coffee };
      case "clock-out":
        return { label: "Clocked Out", color: "#6B7280", icon: LogOut };
      default:
        return { label: "Not Started", color: "#6B7280", icon: Clock };
    }
  }, [currentStatus]);

  const filteredEmployees = useMemo(() => {
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.role && e.role.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [employees, searchQuery]);

  if (authLoading || !isActive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Skeleton className="w-[300px] h-[400px] rounded-md" />
      </div>
    );
  }

  const handleAction = (type: ActionType) => {
    if (!selectedEmployee) return;
    setPendingAction(type);
    setPasscodeDialogOpen(true);
  };

  const submitPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !pendingAction || passcode.length !== 4) return;
    actionMutation.mutate({ employeeId: selectedEmployee.id, type: pendingAction, passcode });
  };

  const handleExitSteepIn = async () => {
    await exitSteepIn();
    setLocation("/login");
  };

  if (selectedEmployee) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="flex items-center justify-between gap-4 p-4 border-b">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedEmployee(null)}
            data-testid="button-kiosk-back"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="text-sm text-muted-foreground font-mono" data-testid="text-kiosk-time">
            {format(new Date(), "EEEE, MMM d, yyyy - h:mm a")}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExitSteepIn}
            data-testid="button-exit-kiosk"
          >
            Exit SteepIn
          </Button>
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-3">
              <EmployeeAvatar name={selectedEmployee.name} color={selectedEmployee.color} size="lg" />
              <div>
                <h2 className="text-xl font-bold" data-testid="text-kiosk-employee-name">{selectedEmployee.name}</h2>
                <p className="text-sm text-muted-foreground">{selectedEmployee.role || "Unassigned"}</p>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-primary">SteepIn</h1>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                size="lg"
                className="h-20 flex flex-col gap-1 text-sm"
                style={{ backgroundColor: "#10B981" }}
                disabled={currentStatus === "clock-in" || currentStatus === "break-start" || actionMutation.isPending}
                onClick={() => handleAction("clock-in")}
                data-testid="button-clock-in"
              >
                <LogIn className="w-6 h-6" />
                Clock In
              </Button>
              <Button
                size="lg"
                className="h-20 flex flex-col gap-1 text-sm"
                style={{ backgroundColor: "#EF4444" }}
                disabled={(currentStatus !== "clock-in" && currentStatus !== "break-end") || actionMutation.isPending}
                onClick={() => handleAction("clock-out")}
                data-testid="button-clock-out"
              >
                <LogOut className="w-6 h-6" />
                Clock Out
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-20 flex flex-col gap-1 text-sm"
                disabled={(currentStatus !== "clock-in" && currentStatus !== "break-end") || actionMutation.isPending}
                onClick={() => handleAction("break-start")}
                data-testid="button-break-start"
              >
                <Coffee className="w-6 h-6" />
                Start Break
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-20 flex flex-col gap-1 text-sm"
                disabled={currentStatus !== "break-start" || actionMutation.isPending}
                onClick={() => handleAction("break-end")}
                data-testid="button-break-end"
              >
                <Timer className="w-6 h-6" />
                End Break
              </Button>
            </div>

            {entries.length > 0 && (
              <Card className="p-4">
                <h3 className="text-xs font-semibold text-muted-foreground mb-2">Today's Activity</h3>
                <div className="space-y-1.5">
                  {entries.map((entry) => {
                    const typeLabels: Record<string, { label: string; color: string }> = {
                      "clock-in": { label: "Clock In", color: "#10B981" },
                      "clock-out": { label: "Clock Out", color: "#EF4444" },
                      "break-start": { label: "Break Start", color: "#F59E0B" },
                      "break-end": { label: "Break End", color: "#3B82F6" },
                    };
                    const info = typeLabels[entry.type] || { label: entry.type, color: "#6B7280" };
                    return (
                      <div key={entry.id} className="flex items-center justify-between text-xs" data-testid={`time-entry-${entry.id}`}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                          <span>{info.label}</span>
                        </div>
                        <span className="text-muted-foreground font-mono">
                          {format(new Date(entry.timestamp), "h:mm:ss a")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </div>

        <Dialog open={passcodeDialogOpen} onOpenChange={(open) => {
          if (!actionMutation.isPending) {
            setPasscodeDialogOpen(open);
            if (!open) setPasscode("");
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Enter Passcode</DialogTitle>
              <DialogDescription>
                Please enter your 4-digit passcode to confirm this action.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitPasscode} className="space-y-4">
              <div className="flex justify-center">
                <Input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-32 text-center text-2xl tracking-[1em] h-12"
                  autoFocus
                  required
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPasscodeDialogOpen(false)}
                  disabled={actionMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={passcode.length !== 4 || actionMutation.isPending}
                >
                  {actionMutation.isPending ? "Verifying..." : "Confirm"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between gap-4 p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
            <Clock className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">SteepIn</h1>
            <p className="text-[10px] text-muted-foreground">Select your name to record your work actions</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExitSteepIn}
          data-testid="button-exit-kiosk-list"
        >
          Exit SteepIn
        </Button>
      </header>

      <div className="p-4 border-b">
        <div className="relative max-w-md mx-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
            data-testid="input-kiosk-search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {empsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-md" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {filteredEmployees.map((emp) => (
              <button
                key={emp.id}
                onClick={() => setSelectedEmployee(emp)}
                className="flex flex-col items-center gap-2 p-4 rounded-md border bg-card hover-elevate transition-colors cursor-pointer"
                data-testid={`kiosk-employee-${emp.id}`}
              >
                <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
                <div className="text-center">
                  <div className="text-sm font-medium">{emp.name}</div>
                  <div className="text-[10px] text-muted-foreground">{emp.role || "Unassigned"}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
