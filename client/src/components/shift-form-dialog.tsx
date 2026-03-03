import { useForm } from "react-hook-form";
import { useEffect, useRef, useState } from "react";
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
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
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
  role: z.string().optional(),
});

type ShiftFormValues = z.infer<typeof shiftFormSchema>;

type ShiftWarning = {
  title: string;
  description: string;
  actions: { label: string; variant: "default" | "destructive" | "outline"; onClick: () => void }[];
} | null;

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
  const [shiftWarning, setShiftWarning] = useState<ShiftWarning>(null);
  const pendingData = useRef<ShiftFormValues | null>(null);

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: customRoles = [] } = useQuery<CustomRole[]>({
    queryKey: ["/api/roles"],
  });

  const getDefaultRole = () => {
    if (shift?.role) return shift.role;
    const empId = shift?.employeeId ?? defaultEmployeeId;
    if (empId) {
      const emp = employees.find(e => e.id === empId);
      return emp?.role || "";
    }
    return "";
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
      color: shift?.color ?? "",
      role: getDefaultRole(),
    },
  });

  useEffect(() => {
    if (open) {
      const defaultRole = getDefaultRole();
      const roleColor = customRoles.find(r => r.name === defaultRole)?.color;
      form.reset({
        employeeId: shift?.employeeId ?? defaultEmployeeId ?? 0,
        date: shift?.date ?? defaultDate ?? new Date().toISOString().split("T")[0],
        startTime: shift?.startTime?.slice(0, 5) ?? "09:00",
        endTime: shift?.endTime?.slice(0, 5) ?? "17:00",
        status: shift?.status ?? "scheduled",
        notes: shift?.notes ?? "",
        color: shift?.color ?? roleColor ?? "",
        role: defaultRole,
      });
      pendingData.current = null;
      setShiftWarning(null);
    }
  }, [open, shift, defaultDate, defaultEmployeeId]);

  const watchedEmployeeId = form.watch("employeeId");
  const watchedStartTime = form.watch("startTime");
  const watchedEndTime = form.watch("endTime");
  const isOvernightShift =
    /^\d{2}:\d{2}$/.test(watchedStartTime) &&
    /^\d{2}:\d{2}$/.test(watchedEndTime) &&
    watchedEndTime < watchedStartTime;

  const activeEmployees = employees.filter(e => e.status === "active");

  useEffect(() => {
    if (!open || isEditing) return;
    const emp = employees.find(e => e.id === Number(watchedEmployeeId));
    if (emp?.role) {
      const roleColor = customRoles.find(r => r.name === emp.role)?.color;
      form.setValue("role", emp.role);
      if (roleColor) form.setValue("color", roleColor);
    } else {
      form.setValue("role", "");
      form.setValue("color", "#9CA3AF");
    }
  }, [watchedEmployeeId, open]);

  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const mutation = useMutation({
    mutationFn: async (values: ShiftFormValues) => {
      if (isEditing) {
        return apiRequest("PATCH", `/api/shifts/${shift.id}`, values);
      }
      return apiRequest("POST", "/api/shifts", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({
        title: isEditing ? "Shift updated" : "Shift created",
        description: isEditing
          ? "The shift has been updated successfully."
          : "A new shift has been created.",
      });
      pendingData.current = null;
      onOpenChange(false);
      form.reset();
    },
    onError: (error: Error) => {
      let errorMessage = error.message;
      try {
        // apiRequest might return "409: {"message":"..."}"
        if (errorMessage.includes("{")) {
          const jsonPart = errorMessage.substring(errorMessage.indexOf("{"));
          const parsed = JSON.parse(jsonPart);
          if (parsed.message) errorMessage = parsed.message;
        } else if (errorMessage.includes(": ")) {
          errorMessage = errorMessage.split(": ").slice(1).join(": ");
        }
      } catch (e) {
        // fallback to original message if parsing fails
      }

      if (errorMessage.toLowerCase().includes("overlap")) {
        setShiftWarning({
          title: "Overlapping Shift",
          description: errorMessage,
          actions: [{ label: "OK", variant: "outline", onClick: () => setShiftWarning(null) }],
        });
      } else {
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    },
  });

  const runMutate = (values: ShiftFormValues) => {
    const roleColor = customRoles.find(r => r.name === values.role)?.color;
    mutation.mutate({
      ...values,
      color: values.role ? (roleColor || values.color || "#9CA3AF") : "#9CA3AF",
    });
  };

  const onSubmit = (values: ShiftFormValues) => {
    const start = toMinutes(values.startTime);
    const end = toMinutes(values.endTime);
    const durationMinutes = end <= start ? end + 1440 - start : end - start;
    const durationHours = Math.floor(durationMinutes / 60);
    const durationMins = durationMinutes % 60;
    const durationLabel = durationMins > 0 ? `${durationHours}h ${durationMins}m` : `${durationHours}h`;

    if (durationMinutes > 900 && !pendingData.current) {
      pendingData.current = values;
      setShiftWarning({
        title: "Very Long Shift",
        description: `This shift is ${durationLabel} long. Are you sure this is correct?`,
        actions: [
          {
            label: "Yes, Save It",
            variant: "default",
            onClick: () => {
              setShiftWarning(null);
              runMutate(pendingData.current!);
              pendingData.current = null;
            },
          },
          {
            label: "Cancel",
            variant: "outline",
            onClick: () => {
              pendingData.current = null;
              setShiftWarning(null);
            },
          },
        ],
      });
      return;
    }

    runMutate(values);
  };

  return (
    <>
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
                          {activeEmployees.map((emp) => (
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
                                  {emp.role || "No Role"}
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
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role for this shift</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          const actualVal = val === "none" ? "" : val;
                          field.onChange(actualVal);
                          const roleColor = customRoles.find(r => r.name === actualVal)?.color;
                          if (roleColor) form.setValue("color", roleColor);
                        }}
                        value={field.value || "none"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-shift-role">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none" className="text-muted-foreground italic">Default Employee Role</SelectItem>
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
                          No roles created yet. Add them in{" "}
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
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {isOvernightShift && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 -mt-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Overnight shift — ends the next day.
                  </p>
                )}
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
                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full sm:w-auto px-8"
                    data-testid="button-save-shift"
                  >
                    {mutation.isPending
                      ? "Saving..."
                      : isEditing
                        ? "Update Shift"
                        : "Create Shift"}
                  </Button>
                </div>
              </form>
            )}
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={shiftWarning !== null} onOpenChange={(open) => { if (!open) setShiftWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{shiftWarning?.title}</AlertDialogTitle>
            <AlertDialogDescription>{shiftWarning?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {shiftWarning?.actions.map((action) => (
              <Button
                key={action.label}
                variant={action.variant}
                onClick={action.onClick}
                data-testid={`button-warning-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {action.label}
              </Button>
            ))}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
