import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee, Shift } from "@shared/schema";
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
import { Input } from "@/components/ui/input";
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
import { SHIFT_COLORS } from "@/lib/constants";
import { EmployeeAvatar } from "./employee-avatar";

const shiftFormSchema = z.object({
  employeeId: z.coerce.number().min(1, "Please select an employee"),
  date: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  status: z.string().default("scheduled"),
  notes: z.string().optional(),
  color: z.string().optional(),
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

  const form = useForm<ShiftFormValues>({
    resolver: zodResolver(shiftFormSchema),
    defaultValues: {
      employeeId: shift?.employeeId ?? defaultEmployeeId ?? 0,
      date: shift?.date ?? defaultDate ?? new Date().toISOString().split("T")[0],
      startTime: shift?.startTime?.slice(0, 5) ?? "09:00",
      endTime: shift?.endTime?.slice(0, 5) ?? "17:00",
      status: shift?.status ?? "scheduled",
      notes: shift?.notes ?? "",
      color: shift?.color ?? SHIFT_COLORS[0].value,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        employeeId: shift?.employeeId ?? defaultEmployeeId ?? 0,
        date: shift?.date ?? defaultDate ?? new Date().toISOString().split("T")[0],
        startTime: shift?.startTime?.slice(0, 5) ?? "09:00",
        endTime: shift?.endTime?.slice(0, 5) ?? "17:00",
        status: shift?.status ?? "scheduled",
        notes: shift?.notes ?? "",
        color: shift?.color ?? SHIFT_COLORS[0].value,
      });
    }
  }, [open, shift, defaultDate, defaultEmployeeId]);

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
    const employee = employees.find(e => e.id === Number(values.employeeId));
    mutation.mutate({
      ...values,
      color: (employee?.role ? (employee.color || values.color) : "#9CA3AF")
    });
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {employees.length === 0 ? (
              <div className="py-6 flex flex-col items-center text-center">
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
        </Form>
      </DialogContent>
    </Dialog>
  );
}
