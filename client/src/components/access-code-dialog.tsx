import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { Employee, AccessCode } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmployeeAvatar } from "./employee-avatar";
import { KeyRound, Copy, RefreshCw, Clock, CheckCircle2, XCircle } from "lucide-react";

interface AccessCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccessCodeDialog({ open, onOpenChange }: AccessCodeDialogProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const { toast } = useToast();

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: codes = [], refetch: refetchCodes } = useQuery<AccessCode[]>({
    queryKey: ["/api/access-codes", selectedEmployeeId],
    enabled: !!selectedEmployeeId,
  });

  const generateMutation = useMutation({
    mutationFn: async (employeeId: number) => {
      const res = await apiRequest("POST", "/api/access-codes/generate", { employeeId });
      return res.json();
    },
    onSuccess: () => {
      refetchCodes();
      toast({ title: "Access code generated", description: "A new access code has been created. Previous codes have been expired." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Copied", description: "Access code copied to clipboard." });
  };

  const selectedEmp = employees.find((e) => e.id.toString() === selectedEmployeeId);
  const activeCode = codes.find((c) => !c.used && new Date(c.expiresAt) > new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-access-code-title">
            <KeyRound className="w-5 h-5 text-primary" />
            Employee Access Codes
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Select Employee</label>
            <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger data-testid="select-code-employee">
                <SelectValue placeholder="Choose an employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id.toString()}>
                    <div className="flex items-center gap-2">
                      <EmployeeAvatar name={emp.name} color={emp.color} size="sm" />
                      <span>{emp.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedEmployeeId && (
            <>
              <Button
                onClick={() => generateMutation.mutate(Number(selectedEmployeeId))}
                disabled={generateMutation.isPending}
                className="w-full"
                data-testid="button-generate-code"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
                {generateMutation.isPending ? "Generating..." : activeCode ? "Generate New Code (Expires Old)" : "Generate Access Code"}
              </Button>

              {activeCode && (
                <Card className="p-4 border-primary/30 bg-primary/[0.03]">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium">Active Code</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={activeCode.code}
                      readOnly
                      className="font-mono text-xs"
                      data-testid="input-active-code"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copyToClipboard(activeCode.code)}
                      data-testid="button-copy-code"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Expires {format(new Date(activeCode.expiresAt), "MMM d, yyyy h:mm a")}</span>
                  </div>
                </Card>
              )}

              {codes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Code History</h4>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {codes.map((code) => {
                      const isExpired = new Date(code.expiresAt) <= new Date();
                      const isActive = !code.used && !isExpired;
                      return (
                        <div
                          key={code.id}
                          className="flex items-center justify-between gap-2 text-xs p-2 rounded-md bg-muted/50"
                          data-testid={`code-history-${code.id}`}
                        >
                          <span className="font-mono truncate flex-1">{code.code}</span>
                          <div className="flex items-center gap-1.5">
                            {code.used ? (
                              <Badge variant="secondary" className="text-[10px]">Used</Badge>
                            ) : isExpired ? (
                              <Badge variant="secondary" className="text-[10px]" style={{ color: "#EF4444" }}>
                                <XCircle className="w-2.5 h-2.5 mr-0.5" /> Expired
                              </Badge>
                            ) : (
                              <Badge className="text-[10px]" style={{ backgroundColor: "#10B981" }}>
                                <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> Active
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
