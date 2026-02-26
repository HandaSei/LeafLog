import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Edit2, Check, X, Shield } from "lucide-react";
import type { Role } from "@shared/schema";

export default function SettingsPage() {
  const { toast } = useToast();
  const [newRoleName, setNewRoleName] = useState("");
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [editRoleName, setEditRoleName] = useState("");

  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
    queryFn: getQueryFn(),
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/roles", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setNewRoleName("");
      toast({ title: "Success", description: "Role created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/roles/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setEditingRoleId(null);
      toast({ title: "Success", description: "Role updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({ title: "Success", description: "Role deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    createMutation.mutate(newRoleName.trim());
  };

  const handleUpdate = (id: number) => {
    if (!editRoleName.trim()) return;
    updateMutation.mutate({ id, name: editRoleName.trim() });
  };

  const startEditing = (role: Role) => {
    setEditingRoleId(role.id);
    setEditRoleName(role.name);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and application settings.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <CardTitle>Employee Roles</CardTitle>
          </div>
          <CardDescription>
            Create and manage roles for your employees. Maximum 6 roles allowed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleCreate} className="flex gap-2">
            <Input
              placeholder="e.g. Barista, Kitchen Hand"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              disabled={roles.length >= 6 || createMutation.isPending}
              data-testid="input-new-role"
            />
            <Button 
              type="submit" 
              disabled={roles.length >= 6 || !newRoleName.trim() || createMutation.isPending}
              data-testid="button-add-role"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Role
            </Button>
          </form>

          <div className="space-y-2">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading roles...</div>
            ) : roles.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">No custom roles created yet.</div>
            ) : (
              roles.map((role) => (
                <div 
                  key={role.id} 
                  className="flex items-center justify-between p-3 border rounded-lg bg-card"
                  data-testid={`role-item-${role.id}`}
                >
                  {editingRoleId === role.id ? (
                    <div className="flex-1 flex gap-2 mr-4">
                      <Input
                        value={editRoleName}
                        onChange={(e) => setEditRoleName(e.target.value)}
                        className="h-8"
                        autoFocus
                        data-testid={`input-edit-role-${role.id}`}
                      />
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8 text-green-600"
                        onClick={() => handleUpdate(role.id)}
                        data-testid={`button-confirm-edit-${role.id}`}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8 text-red-600"
                        onClick={() => setEditingRoleId(null)}
                        data-testid={`button-cancel-edit-${role.id}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium">{role.name}</span>
                      <div className="flex gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8"
                          onClick={() => startEditing(role)}
                          data-testid={`button-edit-role-${role.id}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteMutation.mutate(role.id)}
                          data-testid={`button-delete-role-${role.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
          
          {roles.length >= 6 && (
            <p className="text-xs text-amber-600 font-medium">
              You have reached the maximum limit of 6 roles.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
