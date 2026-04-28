import type { Employee } from "@shared/schema";

type ArchiveState = Pick<Employee, "hiddenFromSteepin">;
type VisibleEmployeeState = Pick<Employee, "status" | "hiddenFromSteepin">;

export function isEmployeeArchived(employee: ArchiveState): boolean {
  return employee.hiddenFromSteepin === true;
}

export function isActiveUnarchivedEmployee(employee: VisibleEmployeeState): boolean {
  return employee.status === "active" && !isEmployeeArchived(employee);
}
