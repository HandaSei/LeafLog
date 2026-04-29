export const STALE_OPEN_SESSION_MINUTES = 24 * 60;
export const AUTO_CLOSE_BASE_LIMIT_HOURS = 16;
export const AUTO_CLOSE_WITH_LATE_BREAK_LIMIT_HOURS = 24;
export const AUTO_CLOSE_BREAK_THRESHOLD_HOURS = 10;
export const OFFLINE_ACTION_MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

export type WorkEntryType =
  | "clock-in"
  | "clock-out"
  | "break-start"
  | "break-end"
  | "shift-reopened";

export type TimeStampedEntry = {
  type: string;
  timestamp: string | Date;
};

export function isOpenSessionEntryType(type: string | null | undefined): boolean {
  return type === "clock-in" || type === "break-start" || type === "break-end";
}

export function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function getAutoCloseLimitHours(entries: TimeStampedEntry[], lastClockInTime: Date): number {
  const lateBreakThresholdMs = lastClockInTime.getTime() + AUTO_CLOSE_BREAK_THRESHOLD_HOURS * 60 * 60 * 1000;
  const hasLateBreak = entries.some(
    (entry) => entry.type === "break-start" && new Date(entry.timestamp).getTime() > lateBreakThresholdMs,
  );
  return hasLateBreak ? AUTO_CLOSE_WITH_LATE_BREAK_LIMIT_HOURS : AUTO_CLOSE_BASE_LIMIT_HOURS;
}
