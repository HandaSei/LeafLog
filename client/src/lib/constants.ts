export const ROLE_COLORS = [
  "#8B9E8B", // Sage Green (Primary)
  "#3B82F6", // Blue
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#EF4444", // Red
  "#8B5CF6", // Violet
  "#EC4899", // Pink
  "#06B6D4", // Cyan
];

export const SHIFT_COLORS = [
  { name: "Blue", value: "#3B82F6" },
  { name: "Green", value: "#10B981" },
  { name: "Purple", value: "#8B5CF6" },
  { name: "Amber", value: "#F59E0B" },
  { name: "Rose", value: "#F43F5E" },
  { name: "Cyan", value: "#06B6D4" },
  { name: "Orange", value: "#F97316" },
  { name: "Indigo", value: "#6366F1" },
];

export const EMPLOYEE_COLORS = [
  "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B",
  "#F43F5E", "#06B6D4", "#F97316", "#6366F1",
  "#EC4899", "#14B8A6",
];

export const ROLES = [
  "Manager", "Supervisor", "Team Lead", "Staff", "Part-time", "Intern",
];

export const SHIFT_STATUSES = [
  { value: "scheduled", label: "Scheduled", color: "#3B82F6" },
  { value: "in-progress", label: "In Progress", color: "#F59E0B" },
  { value: "completed", label: "Completed", color: "#10B981" },
  { value: "cancelled", label: "Cancelled", color: "#EF4444" },
];

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  return `${hours.padStart(2, "0")}:${minutes}`;
}

export function getDaysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}
