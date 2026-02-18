import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from "date-fns";
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
import { CalendarDays, Clock, FileText } from "lucide-react";
import type { Employee, TimeEntry } from "@shared/schema";

export default function Timesheets() {
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("all");

  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/kiosk/entries"], // We'll need a way to get all entries or filter by range
  });

  const weekDays = useMemo(() => {
    return eachDayOfInterval({
      start: selectedWeek,
      end: endOfWeek(selectedWeek, { weekStartsOn: 1 }),
    });
  }, [selectedWeek]);

  const processedData = useMemo(() => {
    const data = new Map<number, Map<string, number>>();
    
    entries.forEach(entry => {
      const date = entry.date;
      const empId = entry.employeeId;
      
      if (!data.has(empId)) data.set(empId, new Map());
      const empMap = data.get(empId)!;
      
      // Basic calculation: total hours between clock-in and clock-out
      // This is a simplified version - in a real app you'd pair entries
      // For now, let's just count total entries as a placeholder or 
      // implement a simple pairing logic if possible.
    });

    return data;
  }, [entries]);

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
                  <TableHead className="text-right font-bold">Total</TableHead>
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
                        return (
                          <TableCell key={day.toISOString()} className="text-center">
                            {dayEntries.length > 0 ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {dayEntries.length} punches
                              </Badge>
                            ) : "-"}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-bold">
                        {entries.filter(e => e.employeeId === emp.id).length}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
