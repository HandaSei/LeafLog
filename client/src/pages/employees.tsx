import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Users, Plus, Search, MoreHorizontal, Pencil, Trash2, Mail, Phone } from "lucide-react";
import { EmployeeFormDialog } from "@/components/employee-form-dialog";
import { EmployeeAvatar } from "@/components/employee-avatar";

export default function Employees() {
  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const { toast } = useToast();

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/employees/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Employee removed", description: "The employee has been removed." });
      setDeleteDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filtered = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditingEmployee(null);
    setFormOpen(true);
  };

  const handleDelete = (emp: Employee) => {
    setEmployeeToDelete(emp);
    setDeleteDialogOpen(true);
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
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[140px] rounded-md" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Users className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-base font-medium text-muted-foreground">
              {searchQuery ? "No employees found" : "No employees yet"}
            </h3>
            <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
              {searchQuery
                ? "Try adjusting your search"
                : "Add your first employee to get started"}
            </p>
            {!searchQuery && (
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
                      <div className="text-xs text-muted-foreground truncate">{emp.role}</div>
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
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="w-3 h-3" />
                    <span className="truncate">{emp.email}</span>
                  </div>
                  {emp.phone && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="w-3 h-3" />
                      <span>{emp.phone}</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">
                    {emp.department}
                  </Badge>
                  <Badge
                    variant={emp.status === "active" ? "default" : "secondary"}
                    className="text-[10px]"
                    style={emp.status === "active" ? { backgroundColor: "#10B981" } : {}}
                  >
                    {emp.status === "active" ? "Active" : "Inactive"}
                  </Badge>
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {employeeToDelete?.name}? This will also delete all their assigned shifts. This action cannot be undone.
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
    </div>
  );
}
