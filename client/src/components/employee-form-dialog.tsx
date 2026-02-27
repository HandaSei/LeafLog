import { useForm } from "react-hook-form";
import { useState, useEffect, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee, CustomRole } from "@shared/schema";
import { AlertCircle, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMPLOYEE_COLORS } from "@/lib/constants";

const employeeFormSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  email: z.string().email("Valid email is required").optional().or(z.literal("")),
  phone: z.string().optional(),
  role: z.string().optional(),
  department: z.string().optional(),
  color: z.string().default("#3B82F6"),
  status: z.string().default("active"),
  accessCode: z.string().min(4, "Passcode must be 4–6 digits").max(6, "Passcode must be 4–6 digits").regex(/^[0-9]+$/, "Passcode must be numeric"),
});

type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

function randomPasscode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

interface EmployeeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: Employee | null;
}

export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
}: EmployeeFormDialogProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isEditing = !!employee;
  const [showRoleChangeConfirm, setShowRoleChangeConfirm] = useState(false);
  const [pendingValues, setPendingValues] = useState<EmployeeFormValues | null>(null);

  const { data: customRoles = [] } = useQuery<CustomRole[]>({
    queryKey: ["/api/roles"],
  });

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      role: "",
      department: "",
      color: EMPLOYEE_COLORS[0],
      status: "active",
      accessCode: randomPasscode(),
    },
  });

  useEffect(() => {
    if (open) {
      setShowRoleChangeConfirm(false);
      setPendingValues(null);
      form.reset({
        name: employee?.name ?? "",
        email: employee?.email ?? "",
        phone: employee?.phone ?? "",
        role: employee?.role ?? "",
        department: employee?.department ?? "",
        color: employee?.color ?? EMPLOYEE_COLORS[0],
        status: employee?.status ?? "active",
        accessCode: employee?.accessCode ?? randomPasscode(),
      });
    }
  }, [open, employee]);

  const regenerate = useCallback(() => {
    form.setValue("accessCode", randomPasscode(), { shouldValidate: true });
  }, [form]);

  const updateShiftRolesMutation = useMutation({
    mutationFn: async ({ employeeId, role, color }: { employeeId: number; role: string; color: string }) => {
      return apiRequest("POST", `/api/employees/${employeeId}/update-shift-roles`, { role, color });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Shifts updated", description: "All existing shifts have been updated with the new role." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const mutation = useMutation({
    mutationFn: async (values: EmployeeFormValues) => {
      if (isEditing) {
        return apiRequest("PATCH", `/api/employees/${employee.id}`, values);
      }
      return apiRequest("POST", "/api/employees", values);
    },
    onSuccess: (_data, values) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({
        title: isEditing ? "Employee updated" : "Employee added",
        description: isEditing
          ? "Employee details have been updated."
          : "A new employee has been added.",
      });
      if (isEditing && employee.role !== values.role && values.role) {
        setPendingValues(values);
        setShowRoleChangeConfirm(true);
      } else {
        onOpenChange(false);
        form.reset();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleConfirmUpdateShifts = () => {
    if (!pendingValues || !employee) return;
    const roleColor = customRoles.find(r => r.name === pendingValues.role)?.color || pendingValues.color;
    updateShiftRolesMutation.mutate(
      { employeeId: employee.id, role: pendingValues.role!, color: roleColor },
      {
        onSettled: () => {
          setShowRoleChangeConfirm(false);
          setPendingValues(null);
          onOpenChange(false);
          form.reset();
        },
      }
    );
  };

  const handleSkipUpdateShifts = () => {
    setShowRoleChangeConfirm(false);
    setPendingValues(null);
    onOpenChange(false);
    form.reset();
  };

  const onSubmit = (values: EmployeeFormValues) => {
    const roleColor = customRoles.find(r => r.name === values.role)?.color;
    mutation.mutate({
      ...values,
      color: roleColor || values.color
    });
  };

  return (
    <>
    <Dialog open={open && !showRoleChangeConfirm} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle data-testid="text-employee-form-title">
            {isEditing ? "Edit Employee" : "Add New Employee"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="John Smith"
                      data-testid="input-employee-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="john@company.com"
                      data-testid="input-employee-email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="(555) 123-4567"
                      data-testid="input-employee-phone"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-3">
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role (optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-role">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customRoles.map((r) => (
                          <SelectItem key={r.id} value={r.name}>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                              {r.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {customRoles.length === 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
                        <AlertCircle className="w-3 h-3 text-amber-500" />
                        No roles created yet. You can add them in 
                        <button 
                          type="button"
                          className="text-primary hover:underline font-medium"
                          onClick={() => {
                            onOpenChange(false);
                            setLocation("/settings");
                          }}
                        >
                          Settings
                        </button>
                        (optional).
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="accessCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SteepIn Passcode (4–6 digits)</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder="e.g. 1234"
                        maxLength={6}
                        inputMode="numeric"
                        data-testid="input-employee-passcode"
                        {...field}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                          field.onChange(val);
                        }}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="flex-shrink-0 h-9 w-9"
                      onClick={regenerate}
                      title="Generate random passcode"
                      data-testid="button-regenerate-passcode"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    4 digits generated automatically — customise or regenerate as needed
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-employee"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                data-testid="button-save-employee"
              >
                {mutation.isPending
                  ? "Saving..."
                  : isEditing
                    ? "Update Employee"
                    : "Add Employee"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    <Dialog open={showRoleChangeConfirm} onOpenChange={(v) => { if (!v) handleSkipUpdateShifts(); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Update existing shifts?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You changed this employee's role to <strong>{pendingValues?.role}</strong>. Do you want to update all their existing shifts to use the new role and color too?
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleSkipUpdateShifts}
            data-testid="button-skip-shift-update"
          >
            No, keep existing shifts
          </Button>
          <Button
            onClick={handleConfirmUpdateShifts}
            disabled={updateShiftRolesMutation.isPending}
            data-testid="button-confirm-shift-update"
          >
            {updateShiftRolesMutation.isPending ? "Updating..." : "Yes, update all shifts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
