import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, parseISO, differenceInMinutes } from "date-fns";
import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, ChevronLeft, ChevronRight, Edit2, Clock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee, TimeEntry } from "@shared/schema";

export default function Timesheets() {
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("all");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [viewingDetails, setViewingDetails] = useState<{ employeeId: number; date: string } | null>(null);
  const { toast } = useToast();

  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/kiosk/entries"],
  });

  const updateEntryMutation = useMutation({
    mutationFn: async (entry: Partial<TimeEntry> & { id: number }) => {
      const res = await apiRequest("PATCH", `/api/kiosk/entries/${entry.id}`, entry);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk/entries"] });
      toast({ title: "Success", description: "Entry updated successfully" });
      setEditingEntry(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const weekDays = useMemo(() => {
    return eachDayOfInterval({
      start: selectedWeek,
      end: endOfWeek(selectedWeek, { weekStartsOn: 1 }),
    });
  }, [selectedWeek]);

  const calculateWorkedTime = (dayEntries: TimeEntry[]) => {
    if (dayEntries.length < 2) return null;
    
    const sorted = [...dayEntries].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    const start = sorted.find(e => e.type === "clock-in");
    const end = [...sorted].reverse().find(e => e.type === "clock-out");
    
    if (!start || !end) return null;
    
    const startTime = new Date(start.timestamp);
    const endTime = new Date(end.timestamp);
    
    const totalMinutes = differenceInMinutes(endTime, startTime);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    return {
      start: format(startTime, "HH:mm"),
      end: format(endTime, "HH:mm"),
      duration: `${hours}h ${minutes}m`
    };
  };

  const navigateWeek = (direction: number) => {
    const next = new Date(selectedWeek);
    next.setDate(next.getDate() + (direction * 7));
    setSelectedWeek(next);
  };

  if (empsLoading || entriesLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Timesheets</h1>
        </div>
        <div className="flex items-center gap-2 bg-muted rounded-md p-1">
          <Button variant="ghost" size="icon" onClick={() => navigateWeek(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium px-2">
            {format(selectedWeek, "MMM d")} - {format(endOfWeek(selectedWeek, { weekStartsOn: 1 }), "MMM d")}
          </span>
          <Button variant="ghost" size="icon" onClick={() => navigateWeek(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-sm font-medium">Weekly Overview</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map(emp => (
                  <SelectItem key={emp.id} value={emp.id.toString()}>{emp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  {weekDays.map(day => (
                    <TableHead key={day.toISOString()} className="text-center">
                      {format(day, "EEE d")}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees
                  .filter(emp => selectedEmployeeId === "all" || emp.id.toString() === selectedEmployeeId)
                  .map(emp => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      {weekDays.map(day => {
                        const dateStr = format(day, "yyyy-MM-dd");
                        const dayEntries = entries.filter(e => e.employeeId === emp.id && e.date === dateStr);
                        const worked = calculateWorkedTime(dayEntries);
                        
                        return (
                          <TableCell key={day.toISOString()} className="text-center">
                            {worked ? (
                              <button 
                                onClick={() => setViewingDetails({ employeeId: emp.id, date: dateStr })}
                                className="group flex flex-col items-center hover-elevate p-1 rounded-sm w-full transition-colors"
                              >
                                <span className="text-xs font-bold text-primary">{worked.start} - {worked.end}</span>
                                <Badge variant="secondary" className="text-[10px] mt-1">
                                  {worked.duration}
                                </Badge>
                              </button>
                            ) : (
                              dayEntries.length > 0 ? (
                                <button 
                                  onClick={() => setViewingDetails({ employeeId: emp.id, date: dateStr })}
                                  className="text-[10px] text-muted-foreground hover:text-primary underline flex items-center justify-center gap-1 mx-auto"
                                >
                                  <Info className="w-3 h-3" /> {dayEntries.length} actions
                                </button>
                              ) : "-"
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={!!viewingDetails} onOpenChange={() => setViewingDetails(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Daily Actions</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {viewingDetails && entries
              .filter(e => e.employeeId === viewingDetails.employeeId && e.date === viewingDetails.date)
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .map(entry => (
                <div key={entry.id} className="flex items-center justify-between p-2 rounded-md border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium capitalize">{entry.type.replace('-', ' ')}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(entry.timestamp), "h:mm:ss a")}</div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setEditingEntry(entry)}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingEntry} onOpenChange={() => setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Action</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select 
                value={editingEntry?.type} 
                onValueChange={(val: any) => setEditingEntry(prev => prev ? {...prev, type: val} : null)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clock-in">Clock In</SelectItem>
                  <SelectItem value="clock-out">Clock Out</SelectItem>
                  <SelectItem value="break-start">Break Start</SelectItem>
                  <SelectItem value="break-end">Break End</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timestamp</Label>
              <Input 
                type="datetime-local" 
                value={editingEntry ? format(new Date(editingEntry.timestamp), "yyyy-MM-dd'T'HH:mm") : ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditingEntry(prev => {
                    if (!prev) return null;
                    return {
                      ...prev,
                      timestamp: new Date(val)
                    };
                  });
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>Cancel</Button>
            <Button 
              onClick={() => editingEntry && updateEntryMutation.mutate({
                id: editingEntry.id,
                type: editingEntry.type,
                timestamp: editingEntry.timestamp
              })}
              disabled={updateEntryMutation.isPending}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
