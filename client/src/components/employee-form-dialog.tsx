import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee, CustomRole } from "@shared/schema";
import { AlertCircle } from "lucide-react";
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
  accessCode: z.string().length(4, "Passcode must be 4 digits").regex(/^[0-9]+$/, "Passcode must be numeric"),
});

type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

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

  const { data: customRoles = [] } = useQuery<CustomRole[]>({
    queryKey: ["/api/roles"],
  });

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      name: employee?.name ?? "",
      email: employee?.email ?? "",
      phone: employee?.phone ?? "",
      role: employee?.role ?? "",
      department: employee?.department ?? "",
      color: employee?.color ?? EMPLOYEE_COLORS[0],
      status: employee?.status ?? "active",
      accessCode: employee?.accessCode ?? "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: employee?.name ?? "",
        email: employee?.email ?? "",
        phone: employee?.phone ?? "",
        role: employee?.role ?? "",
        department: employee?.department ?? "",
        color: employee?.color ?? EMPLOYEE_COLORS[0],
        status: employee?.status ?? "active",
        accessCode: employee?.accessCode ?? "",
      });
    }
  }, [open, employee]);

  const mutation = useMutation({
    mutationFn: async (values: EmployeeFormValues) => {
      if (isEditing) {
        return apiRequest("PATCH", `/api/employees/${employee.id}`, values);
      }
      return apiRequest("POST", "/api/employees", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({
        title: isEditing ? "Employee updated" : "Employee added",
        description: isEditing
          ? "Employee details have been updated."
          : "A new employee has been added.",
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

  const onSubmit = (values: EmployeeFormValues) => {
    const roleColor = customRoles.find(r => r.name === values.role)?.color;
    mutation.mutate({
      ...values,
      color: roleColor || values.color
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  <FormLabel>SteepIn Passcode (4 digits)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. 1234"
                      maxLength={4}
                      data-testid="input-employee-passcode"
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
  );
}
