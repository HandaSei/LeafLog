import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addDays, subDays } from "date-fns";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmployeeAvatar } from "@/components/employee-avatar";
import type { Employee, TimeEntry } from "@shared/schema";

export default function Timesheets() {
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedRole, setSelectedRole] = useState<string>("all");

  const { data: employees = [], isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/kiosk/entries"],
  });

  const weekDays = useMemo(() => {
    return eachDayOfInterval({
      start: selectedWeek,
      end: endOfWeek(selectedWeek, { weekStartsOn: 1 }),
    });
  }, [selectedWeek]);

  const navigateWeek = (direction: number) => {
    setSelectedWeek(prev => direction > 0 ? addDays(prev, 7) : subDays(prev, 7));
  };

  const roles = useMemo(() => {
    const r = new Set(employees.map(e => e.role));
    return Array.from(r);
  }, [employees]);

  const calculateHours = (empEntries: TimeEntry[]) => {
    // Basic calculation for display: count duration between clock-in and clock-out
    if (empEntries.length < 2) return 0;
    const sorted = [...empEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let totalMs = 0;
    let lastIn: Date | null = null;

    sorted.forEach(entry => {
      if (entry.type === "clock-in") lastIn = new Date(entry.timestamp);
      else if (entry.type === "clock-out" && lastIn) {
        totalMs += new Date(entry.timestamp).getTime() - lastIn.getTime();
        lastIn = null;
      }
    });
    return totalMs / (1000 * 60 * 60);
  };

  if (empsLoading || entriesLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredEmployees = employees.filter(emp => selectedRole === "all" || emp.role === selectedRole);

  const totalWeeklyHours = filteredEmployees.reduce((acc, emp) => {
    const empEntries = entries.filter(e => e.employeeId === emp.id && weekDays.some(d => format(d, "yyyy-MM-dd") === e.date));
    return acc + calculateHours(empEntries);
  }, 0);

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between bg-white border-b">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold text-slate-900">Timesheets</h1>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600">
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Date Navigation */}
      <div className="px-4 py-4 bg-white space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 font-semibold text-slate-900">
            {format(selectedWeek, "MMM yyyy")}
            <ChevronLeft className="h-4 w-4 ml-1 rotate-270" />
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => navigateWeek(-1)} className="text-slate-400 hover:text-slate-600">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={() => navigateWeek(1)} className="text-slate-400 hover:text-slate-600">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Days Header */}
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((day, idx) => {
            const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
            return (
              <div key={idx} className="flex flex-col items-center gap-2">
                <span className="text-[10px] font-medium text-slate-400 uppercase">{format(day, "EEEEE")}</span>
                <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium transition-colors
                  ${isToday ? "bg-blue-600 text-white" : "text-slate-600"}`}>
                  {format(day, "d")}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-4 py-3 flex items-center gap-2 overflow-x-auto">
        <div className="p-1.5 rounded-md bg-white border border-slate-200">
          <ChevronLeft className="h-4 w-4 text-slate-400" />
        </div>
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="h-9 w-auto min-w-[120px] bg-white border-slate-200 rounded-lg text-slate-600">
            <SelectValue placeholder="Positions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Positions</SelectItem>
            {roles.map(role => (
              <SelectItem key={role} value={role}>{role}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Week Range Display */}
      <div className="px-6 py-2">
        <p className="text-xs font-medium text-slate-400">
          &lt; {format(selectedWeek, "MMM d")} - {format(endOfWeek(selectedWeek, { weekStartsOn: 1 }), "MMM d")} &gt;
        </p>
      </div>

      {/* Timesheet List */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3">
        {filteredEmployees.map(emp => {
          const empEntries = entries.filter(e => e.employeeId === emp.id && weekDays.some(d => format(d, "yyyy-MM-dd") === e.date));
          const hours = calculateHours(empEntries);
          
          if (empEntries.length === 0) return null;

          // Group by date for range display
          const sorted = [...empEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          const start = sorted.find(e => e.type === "clock-in");
          const end = [...sorted].reverse().find(e => e.type === "clock-out");

          return (
            <Card key={emp.id} className="border-none shadow-sm rounded-xl overflow-hidden">
              <div className="p-4 flex items-start justify-between bg-white">
                <div className="flex gap-3">
                  <EmployeeAvatar name={emp.name} color={emp.color} size="sm" className="h-10 w-10 text-xs" />
                  <div className="space-y-1">
                    <h3 className="font-medium text-slate-900">{emp.name}</h3>
                    <div className="text-sm font-bold text-slate-950">
                      {start ? format(new Date(start.timestamp), "HH:mm") : "--:--"} - {end ? format(new Date(end.timestamp), "HH:mm") : "--:--"}
                    </div>
                    <p className="text-xs text-slate-400 font-medium">Bar New Prosit</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <Badge variant="secondary" className="bg-orange-50 text-orange-700 hover:bg-orange-50 border-none font-semibold px-2 py-0.5 rounded-lg text-[10px]">
                    Pending
                  </Badge>
                  <div className="text-sm font-semibold text-slate-400">
                    {hours.toFixed(2)} h
                  </div>
                </div>
              </div>
            </Card>
          );
        })}

        {/* Total Display */}
        <div className="pt-2 pr-2 flex justify-end">
          <div className="text-lg font-bold text-slate-900 flex items-baseline gap-2">
            <span className="text-slate-400 font-semibold text-sm uppercase tracking-wide">Total:</span>
            {totalWeeklyHours.toFixed(2)} h
          </div>
        </div>
      </div>
    </div>
  );
}
