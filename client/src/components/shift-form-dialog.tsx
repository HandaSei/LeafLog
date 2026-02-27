import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee, Shift, CustomRole } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertCircle } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/time-input";
import { DateInput } from "@/components/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmployeeAvatar } from "./employee-avatar";

const shiftFormSchema = z.object({
  employeeId: z.coerce.number().min(1, "Please select an employee"),
  date: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  status: z.string().default("scheduled"),
  notes: z.string().optional(),
  color: z.string().optional(),
  shiftRole: z.string().optional(),
});

type ShiftFormValues = z.infer<typeof shiftFormSchema>;

interface ShiftFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift?: Shift | null;
  defaultDate?: string;
  defaultEmployeeId?: number;
}

export function ShiftFormDialog({
  open,
  onOpenChange,
  shift,
  defaultDate,
  defaultEmployeeId,
}: ShiftFormDialogProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isEditing = !!shift;

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: roles = [] } = useQuery<CustomRole[]>({
    queryKey: ["/api/roles"],
  });

  const getRoleColor = (roleName: string | null | undefined): string | undefined => {
    if (!roleName) return undefined;
    return roles.find(r => r.name === roleName)?.color;
  };

  const getDefaultShiftRole = (empId: number | null | undefined): string => {
    if (!empId) return "";
    const emp = employees.find(e => e.id === empId);
    return emp?.role || "";
  };

  const form = useForm<ShiftFormValues>({
    resolver: zodResolver(shiftFormSchema),
    defaultValues: {
      employeeId: shift?.employeeId ?? defaultEmployeeId ?? 0,
      date: shift?.date ?? defaultDate ?? new Date().toISOString().split("T")[0],
      startTime: shift?.startTime?.slice(0, 5) ?? "09:00",
      endTime: shift?.endTime?.slice(0, 5) ?? "17:00",
      status: shift?.status ?? "scheduled",
      notes: shift?.notes ?? "",
      color: shift?.color ?? undefined,
      shiftRole: shift?.shiftRole ?? "",
    },
  });

  useEffect(() => {
    if (open) {
      const empId = shift?.employeeId ?? defaultEmployeeId ?? 0;
      const defaultRole = shift?.shiftRole ?? getDefaultShiftRole(empId);
      form.reset({
        employeeId: empId,
        date: shift?.date ?? defaultDate ?? new Date().toISOString().split("T")[0],
        startTime: shift?.startTime?.slice(0, 5) ?? "09:00",
        endTime: shift?.endTime?.slice(0, 5) ?? "17:00",
        status: shift?.status ?? "scheduled",
        notes: shift?.notes ?? "",
        color: shift?.color ?? undefined,
        shiftRole: defaultRole,
      });
    }
  }, [open, shift, defaultDate, defaultEmployeeId, employees, roles]);

  const watchedEmployeeId = form.watch("employeeId");
  const watchedRole = form.watch("shiftRole");

  useEffect(() => {
    if (!open) return;
    if (!isEditing && watchedEmployeeId) {
      const emp = employees.find(e => e.id === Number(watchedEmployeeId));
      if (emp?.role) {
        form.setValue("shiftRole", emp.role);
      } else {
        form.setValue("shiftRole", "");
      }
    }
  }, [watchedEmployeeId, employees, isEditing, open]);

  const previewColor = (() => {
    if (watchedRole) {
      const roleColor = getRoleColor(watchedRole);
      if (roleColor) return roleColor;
    }
    const emp = employees.find(e => e.id === Number(watchedEmployeeId));
    return emp?.color ?? "#9CA3AF";
  })();

  const mutation = useMutation({
    mutationFn: async (values: ShiftFormValues) => {
      const roleColor = getRoleColor(values.shiftRole);
      const emp = employees.find(e => e.id === Number(values.employeeId));
      const color = roleColor ?? emp?.color ?? "#9CA3AF";
      const payload = { ...values, color, shiftRole: values.shiftRole || null };
      if (isEditing) {
        return apiRequest("PATCH", `/api/shifts/${shift.id}`, payload);
      }
      return apiRequest("POST", "/api/shifts", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({
        title: isEditing ? "Shift updated" : "Shift created",
        description: isEditing
          ? "The shift has been updated successfully."
          : "A new shift has been created.",
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: ShiftFormValues) => {
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle data-testid="text-shift-form-title">
            {isEditing ? "Edit Shift" : "Create New Shift"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          {employees.length === 0 ? (
            <div className="py-10 flex flex-col items-center text-center">
              <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No employees found</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-[300px]">
                You need to add at least one employee before you can create a shift.
              </p>
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  setLocation("/employees");
                }}
              >
                Go to Employees
              </Button>
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="employeeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assign Employee</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-employee">
                          <SelectValue placeholder="Select an employee" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {employees.map((emp) => (
                          <SelectItem
                            key={emp.id}
                            value={emp.id.toString()}
                            data-testid={`option-employee-${emp.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <EmployeeAvatar
                                name={emp.name}
                                color={emp.color}
                                size="sm"
                              />
                              <span>{emp.name}</span>
                              <span className="text-muted-foreground text-xs">
                                {emp.role || "Loose Leaf (assign role)"}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="shiftRole"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role for this shift</FormLabel>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20 shadow-sm"
                        style={{ backgroundColor: previewColor }}
                      />
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ?? ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-shift-role">
                            <SelectValue placeholder="No role override" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">No role override</SelectItem>
                          {roles.map((role) => (
                            <SelectItem key={role.id} value={role.name} data-testid={`option-shift-role-${role.id}`}>
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: role.color }} />
                                {role.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-end gap-3">
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <DateInput value={field.value} onChange={field.onChange} data-testid="input-shift-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem className="w-[80px]">
                      <FormLabel>Start</FormLabel>
                      <FormControl>
                        <TimeInput value={field.value} onChange={field.onChange} data-testid="input-shift-start" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endTime"
                  render={({ field }) => (
                    <FormItem className="w-[80px]">
                      <FormLabel>End</FormLabel>
                      <FormControl>
                        <TimeInput value={field.value} onChange={field.onChange} data-testid="input-shift-end" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any additional notes..."
                        className="resize-none"
                        data-testid="input-shift-notes"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel-shift"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  data-testid="button-save-shift"
                >
                  {mutation.isPending
                    ? "Saving..."
                    : isEditing
                      ? "Update Shift"
                      : "Create Shift"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </Form>
      </DialogContent>
    </Dialog>
  );
}
