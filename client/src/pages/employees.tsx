import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { createEmployeeArchivePatch, isEmployeeArchived } from "@/lib/employees";
import { useToast } from "@/hooks/use-toast";
import type { Employee } from "@shared/schema";
import type { RinseEmployeeLimitState } from "@shared/subscription";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Users, Plus, Search, MoreHorizontal, Pencil, Trash2, Mail, Phone, DollarSign, EyeOff, Eye } from "lucide-react";
import { EmployeeFormDialog } from "@/components/employee-form-dialog";
import { PayConfigDialog } from "@/components/pay-config-dialog";
import { EmployeeAvatar } from "@/components/employee-avatar";

function formatEuro(value: number | null | undefined) {
  return `EUR ${(value ?? 0).toFixed(2)}`;
}

function parseApiError(error: Error): { code?: string; message?: string } {
  const jsonText = error.message.replace(/^\d+:\s*/, "");
  try {
    return JSON.parse(jsonText);
  } catch {
    return { message: error.message };
  }
}

function isAfterDate(value: Date | string | null | undefined, compareTo: Date | string | null | undefined) {
  if (!value || !compareTo) return false;
  const date = new Date(value);
  const compareDate = new Date(compareTo);
  return !Number.isNaN(date.getTime())
    && !Number.isNaN(compareDate.getTime())
    && date.getTime() > compareDate.getTime();
}

function isPendingRinseEmployee(employee: Employee | null | undefined, rinseLimit: RinseEmployeeLimitState | undefined) {
  return !!employee && !!rinseLimit?.applies && isAfterDate(employee.subscriptionPendingSince, rinseLimit.currentPeriodStart);
}

function isPaidForCurrentRinsePeriod(employee: Employee | null | undefined, rinseLimit: RinseEmployeeLimitState | undefined) {
  return !!employee
    && !!rinseLimit?.applies
    && !isPendingRinseEmployee(employee, rinseLimit)
    && isAfterDate(employee.archivedAt, rinseLimit.currentPeriodStart);
}

export default function Employees() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 200);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [deleteDialogMode, setDeleteDialogMode] = useState<"normal" | "rinse-pending">("normal");
  const [employeeToUnarchive, setEmployeeToUnarchive] = useState<Employee | null>(null);
  const [unarchiveConfirmOpen, setUnarchiveConfirmOpen] = useState(false);
  const [payConfigOpen, setPayConfigOpen] = useState(false);
  const [payConfigEmployee, setPayConfigEmployee] = useState<Employee | null>(null);
  const { toast } = useToast();

  const { data: employees = [], isLoading, isFetching } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });
  const { data: rinseLimit } = useQuery<RinseEmployeeLimitState>({
    queryKey: ["/api/subscription/rinse-employee-limit"],
  });
  const isUpdating = !isLoading && isFetching;

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/employees/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/rinse-employee-limit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Employee removed", description: "The employee has been removed." });
      setDeleteDialogOpen(false);
      setDeleteDialogMode("normal");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const archiveEmployeeMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: number; archived: boolean }) => {
      return apiRequest("PATCH", `/api/employees/${id}`, createEmployeeArchivePatch(archived));
    },
    onSuccess: (_data, { archived }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/rinse-employee-limit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({
        title: archived ? "Employee archived" : "Employee unarchived",
        description: archived
          ? rinseLimit?.applies
            ? `This employee is hidden across LeafLog. On Rinse, archived data is retained for ${rinseLimit.archivedRetentionDays} days while the account remains paid.`
            : "This employee is hidden from live scheduling, timesheets, exports, and SteepIn."
          : "This employee is visible across the app again.",
      });
    },
    onError: (error: Error, variables) => {
      const payload = parseApiError(error);
      if (payload.code === "RINSE_PENDING_EMPLOYEE_DELETE_REQUIRED") {
        const employee = employees.find((emp) => emp.id === variables.id);
        if (employee) {
          setEmployeeToDelete(employee);
          setDeleteDialogMode("rinse-pending");
          setDeleteDialogOpen(true);
        }
      }
      toast({ title: "Error", description: payload.message || error.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return employees
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.email && e.email.toLowerCase().includes(q)) ||
          (e.role && e.role.toLowerCase().includes(q))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, debouncedSearch]);

  const handleEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditingEmployee(null);
    setFormOpen(true);
  };

  const handleDelete = (emp: Employee, mode: "normal" | "rinse-pending" = "normal") => {
    setEmployeeToDelete(emp);
    setDeleteDialogMode(mode);
    setDeleteDialogOpen(true);
  };

  const handleArchiveToggle = (emp: Employee) => {
    const archived = isEmployeeArchived(emp);

    if (!archived && isPendingRinseEmployee(emp, rinseLimit)) {
      handleDelete(emp, "rinse-pending");
      return;
    }

    if (archived && rinseLimit?.applies) {
      const coveredThisPeriod = isPaidForCurrentRinsePeriod(emp, rinseLimit);
      const activeLimitBlocked = rinseLimit.activeEmployeeCount >= rinseLimit.maxActiveEmployees;
      const creditBlocked = !coveredThisPeriod && rinseLimit.blockCode === "RINSE_PRORATE_PAYMENT_REQUIRED";

      if (activeLimitBlocked || creditBlocked) {
        toast({
          title: "Rinse limit reached",
          description: rinseLimit.blockMessage || "This employee cannot be unarchived on Rinse right now.",
          variant: "destructive",
        });
        return;
      }

      setEmployeeToUnarchive(emp);
      setUnarchiveConfirmOpen(true);
      return;
    }

    archiveEmployeeMutation.mutate({ id: emp.id, archived: !archived });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold" data-testid="text-employees-title">Employees</h2>
          <Badge variant="secondary" className="text-xs">
            {employees.length}
          </Badge>
          {rinseLimit?.applies && (
            <Badge variant="outline" className="text-xs" data-testid="badge-rinse-employee-limit">
              Rinse {rinseLimit.activeEmployeeCount}/{rinseLimit.maxActiveEmployees} active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search employees..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8 w-[240px]"
              data-testid="input-search-employees"
            />
          </div>
          <Button onClick={handleAdd} data-testid="button-add-employee">
            <Plus className="w-4 h-4 mr-1" />
            Add Employee
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isUpdating && (
          <div className="mb-3 text-[11px] text-muted-foreground">
            Updating employees...
          </div>
        )}
        {isLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            Loading employees...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Users className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-base font-medium text-muted-foreground">
              {debouncedSearch ? "No employees found" : "No employees yet"}
            </h3>
            <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
              {debouncedSearch
                ? "Try adjusting your search"
                : "Add your first employee to get started"}
            </p>
            {!debouncedSearch && (
              <Button onClick={handleAdd} data-testid="button-add-first-employee">
                <Plus className="w-4 h-4 mr-1" />
                Add Employee
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((emp) => (
              <Card
                key={emp.id}
                className="p-4 hover-elevate"
                data-testid={`card-employee-${emp.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <EmployeeAvatar name={emp.name} color={emp.color} size="lg" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate" data-testid={`text-employee-name-${emp.id}`}>
                        {emp.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{emp.role || "No Role"}</div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-employee-menu-${emp.id}`}>
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(emp)} data-testid={`button-edit-employee-${emp.id}`}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setPayConfigEmployee(emp); setPayConfigOpen(true); }} data-testid={`button-pay-config-${emp.id}`}>
                        <DollarSign className="w-3.5 h-3.5 mr-2" /> Pay Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleArchiveToggle(emp)}
                        data-testid={`button-toggle-steepin-${emp.id}`}
                      >
                        {isEmployeeArchived(emp)
                          ? <><Eye className="w-3.5 h-3.5 mr-2" /> Unarchive Employee</>
                          : <><EyeOff className="w-3.5 h-3.5 mr-2" /> Archive Employee</>
                        }
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(emp)}
                        className="text-destructive"
                        data-testid={`button-delete-employee-${emp.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-3 space-y-1.5">
                  {emp.email && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Mail className="w-3 h-3" />
                      <span className="truncate">{emp.email}</span>
                    </div>
                  )}
                  {emp.phone && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="w-3 h-3" />
                      <span>{emp.phone}</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={emp.status === "active" ? "default" : "secondary"}
                    className="text-[10px]"
                    style={emp.status === "active" ? { backgroundColor: "#10B981" } : {}}
                  >
                    {emp.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                  {emp.hourlyRate && (
                    <Badge variant="outline" className="text-[10px] gap-0.5" data-testid={`badge-pay-rate-${emp.id}`}>
                      <DollarSign className="w-2.5 h-2.5" />
                      {emp.hourlyRate}/h
                    </Badge>
                  )}
                  {isEmployeeArchived(emp) && (
                    <Badge
                      variant="outline"
                      className="text-[10px] gap-0.5 border-amber-400 text-amber-600 dark:text-amber-400"
                      data-testid={`badge-steepin-off-${emp.id}`}
                    >
                      <EyeOff className="w-2.5 h-2.5" />
                      Archived
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <EmployeeFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingEmployee(null);
        }}
        employee={editingEmployee}
      />

      <PayConfigDialog
        open={payConfigOpen}
        onOpenChange={(open) => {
          setPayConfigOpen(open);
          if (!open) setPayConfigEmployee(null);
        }}
        employee={payConfigEmployee}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteDialogMode === "rinse-pending" ? "Delete employee instead?" : "Remove Employee"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialogMode === "rinse-pending"
                ? `${employeeToDelete?.name ?? "This employee"} was added or reactivated during the current Rinse subscription period. Archiving becomes available after the first renewal. To stop billing before then, delete the employee instead. This deletes their employee record and assigned shifts, and cannot be undone.`
                : `Are you sure you want to remove ${employeeToDelete?.name}? This will also delete all their assigned shifts. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => employeeToDelete && deleteMutation.mutate(employeeToDelete.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unarchiveConfirmOpen} onOpenChange={setUnarchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unarchive employee?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              {isPaidForCurrentRinsePeriod(employeeToUnarchive, rinseLimit) ? (
                <span className="block">
                  This employee was already covered in the current Rinse period, so reactivating them will not add prorated credit now. They will count as active again for future renewals.
                </span>
              ) : (
                <>
                  <span className="block">
                    Unarchiving this employee will not charge anything immediately. At the next renewal, the invoice should include {formatEuro(rinseLimit?.candidateChargeEur)} for this period ({rinseLimit?.candidateChargeDays ?? 0} days) plus {formatEuro(rinseLimit?.monthlyPriceEur)} for the next month.
                  </span>
                  <span className="block">
                    Pending Rinse credit after this change: {formatEuro((rinseLimit?.pendingCreditEur ?? 0) + (rinseLimit?.candidateChargeEur ?? 0))} / {formatEuro(rinseLimit?.proratedCreditLimitEur)}.
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setEmployeeToUnarchive(null)}
              data-testid="button-cancel-rinse-unarchive"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (employeeToUnarchive) {
                  archiveEmployeeMutation.mutate({ id: employeeToUnarchive.id, archived: false });
                }
                setEmployeeToUnarchive(null);
                setUnarchiveConfirmOpen(false);
              }}
              data-testid="button-confirm-rinse-unarchive"
            >
              Unarchive Employee
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
