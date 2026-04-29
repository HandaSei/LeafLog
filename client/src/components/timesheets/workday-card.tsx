import { format } from "date-fns";
import { StickyNote } from "lucide-react";
import type { ApprovalRequest } from "@shared/schema";
import { EmployeeAvatar } from "@/components/employee-avatar";
import {
  formatHoursDecimal,
  formatMinutes,
  type EmployeeWorkday,
} from "@/lib/timesheets/session-engine";

type StatusConfig = Record<string, { label: string; color: string }>;

type WorkdayCardProps = {
  sessions: EmployeeWorkday[];
  date: Date;
  statusConfig: StatusConfig;
  approvalRequests: ApprovalRequest[];
  onViewWorkday: (workday: EmployeeWorkday, date: Date) => void;
};

export function WorkdayCard({
  sessions,
  date,
  statusConfig,
  approvalRequests,
  onViewWorkday,
}: WorkdayCardProps) {
  const employee = sessions[0].employee;
  const totalNet = sessions.reduce((sum, workday) => sum + workday.netWorkedMinutes, 0);
  const isSingle = sessions.length === 1;

  return (
    <div
      className="w-full flex items-center gap-3 p-3 rounded-md border bg-card hover-elevate text-left"
      data-testid={`timesheet-card-${employee.id}`}
    >
      <EmployeeAvatar name={employee.name} color={employee.color} size="sm" />
      <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0 border-r pr-3 min-w-[80px]">
            <span className="text-xs font-semibold truncate block">{employee.name}</span>
            <span className="text-[10px] text-muted-foreground">{employee.role || "No Role"}</span>
          </div>
          <div className="flex items-center gap-4 flex-nowrap">
            {sessions.map((workday, index) => {
              const status = statusConfig[workday.status];
              const entryDate = workday.entries.find(entry => entry.type === "clock-in")?.date;
              const hasPending = entryDate
                ? approvalRequests.some(request =>
                    request.employeeId === workday.employee.id &&
                    request.entryDate === entryDate &&
                    request.status === "pending"
                  )
                : false;
              const hasNotes = workday.entries.some(entry => entry.notes);

              return (
                <button
                  type="button"
                  key={`${workday.employee.id}-${workday.clockIn?.getTime()}-${index}`}
                  onClick={() => onViewWorkday(workday, date)}
                  className={`flex items-center gap-3 flex-shrink-0 cursor-pointer hover:bg-muted/50 rounded px-2 py-1 transition-colors ${!isSingle && index > 0 ? "border-l pl-4" : ""}`}
                >
                  <div className="flex flex-col items-center">
                    <div className="w-1.5 h-1.5 rounded-full mb-1" style={{ backgroundColor: status.color }} />
                    <div className="flex flex-col items-center">
                      <span className="text-xs font-bold whitespace-nowrap">
                        {workday.clockIn ? format(workday.clockIn, "HH:mm") : "--:--"} - {workday.clockOut ? format(workday.clockOut, "HH:mm") : "-"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {workday.status === "incomplete" ? "-" : `${formatHoursDecimal(workday.netWorkedMinutes)}h`}
                        </span>
                        {workday.hasUnfinishedBreak && (
                          <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1 rounded">
                            Unfinished break
                          </span>
                        )}
                        {!workday.hasUnfinishedBreak && workday.status === "completed" && workday.totalBreakMinutes === 0 && workday.netWorkedMinutes >= 375 && (
                          <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1 rounded">
                            No break
                          </span>
                        )}
                        {!workday.hasUnfinishedBreak && workday.totalBreakMinutes > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            (Break {formatMinutes(workday.totalBreakMinutes)}
                            {workday.unpaidBreakMinutes > 0 && <span className="text-red-500 ml-0.5">-{formatMinutes(workday.unpaidBreakMinutes)}</span>})
                          </span>
                        )}
                        {hasPending && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Pending approval" />}
                        {hasNotes && <StickyNote className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <span className="text-xs font-bold text-muted-foreground ml-auto flex-shrink-0 pl-2">
            {formatHoursDecimal(totalNet)} h
          </span>
        </div>
      </div>
    </div>
  );
}
