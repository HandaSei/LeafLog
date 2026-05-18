import { addDays, format, parseISO, subDays } from "date-fns";
import type { Account, Employee, Shift } from "@shared/schema";
import { canUsePaidPlanFeatures } from "../subscription-limits";
import { storage } from "../../storage";
import { toDateOnly } from "../../routes/utils";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export type ClockRoundingResult = {
  timestamp: Date;
  date: string;
  applied: boolean;
  message?: string;
  shiftLabel?: string;
  reason?: "shift-start" | "shift-end" | "nearest-5";
  originalTimestamp: string;
  roundedTimestamp: string;
};

type RoundClockActionInput = {
  account: Account | undefined;
  employee: Employee;
  type: string;
  actionTime: Date;
  entryDate: string;
};

function timeLabel(value: string) {
  return value.slice(0, 5);
}

function shiftBoundaryDate(shift: Shift, boundary: "start" | "end") {
  const date = toDateOnly(shift.date as string | Date);
  const start = parseISO(`${date}T${timeLabel(shift.startTime)}`);
  const endBase = parseISO(`${date}T${timeLabel(shift.endTime)}`);
  const end = endBase.getTime() <= start.getTime() ? addDays(endBase, 1) : endBase;
  return boundary === "start" ? start : end;
}

function roundToNearestFiveMinutes(date: Date) {
  return new Date(Math.round(date.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS);
}

function uniqueDateKeys(...dates: string[]) {
  return Array.from(new Set(dates.filter(Boolean)));
}

async function getCandidateShifts(employeeId: number, entryDate: string, actionTime: Date) {
  const actionDate = format(actionTime, "yyyy-MM-dd");
  const dateKeys = uniqueDateKeys(
    entryDate,
    actionDate,
    format(subDays(parseISO(entryDate), 1), "yyyy-MM-dd"),
    format(addDays(parseISO(entryDate), 1), "yyyy-MM-dd"),
  );
  const shiftLists = await Promise.all(
    dateKeys.map((date) => storage.getShiftsByEmployeeAndDate(employeeId, date)),
  );
  const seen = new Set<number>();
  return shiftLists.flat().filter((shift) => {
    if (seen.has(shift.id)) return false;
    seen.add(shift.id);
    return true;
  });
}

function findClosestShiftBoundary(shifts: Shift[], actionTime: Date, boundary: "start" | "end") {
  let best: { shift: Shift; boundaryTime: Date; diffMs: number } | null = null;
  for (const shift of shifts) {
    const boundaryTime = shiftBoundaryDate(shift, boundary);
    const diffMs = actionTime.getTime() - boundaryTime.getTime();
    if (!best || Math.abs(diffMs) < Math.abs(best.diffMs)) {
      best = { shift, boundaryTime, diffMs };
    }
  }
  return best;
}

export async function roundClockActionIfEnabled(input: RoundClockActionInput): Promise<ClockRoundingResult | null> {
  if (input.type !== "clock-in" && input.type !== "clock-out") {
    return null;
  }
  if (!input.account?.roundClockTimesEnabled || !canUsePaidPlanFeatures(input.account)) {
    return null;
  }

  const candidateShifts = await getCandidateShifts(input.employee.id, input.entryDate, input.actionTime);
  const boundary = input.type === "clock-in" ? "start" : "end";
  const closestBoundary = findClosestShiftBoundary(candidateShifts, input.actionTime, boundary);

  let roundedTimestamp = roundToNearestFiveMinutes(input.actionTime);
  let message: string | undefined;
  let reason: ClockRoundingResult["reason"] = "nearest-5";
  let shiftLabel: string | undefined;

  if (closestBoundary && Math.abs(closestBoundary.diffMs) <= FIVE_MINUTES_MS) {
    roundedTimestamp = closestBoundary.boundaryTime;
    reason = input.type === "clock-in" ? "shift-start" : "shift-end";
    shiftLabel = `${timeLabel(closestBoundary.shift.startTime)} - ${timeLabel(closestBoundary.shift.endTime)}`;
    message = input.type === "clock-in"
      ? "Perfect, you are in time for your shift"
      : "You completed your shift successfully";
  }

  const date = input.type === "clock-in"
    ? format(roundedTimestamp, "yyyy-MM-dd")
    : input.entryDate;
  const applied = roundedTimestamp.getTime() !== input.actionTime.getTime();

  return {
    timestamp: roundedTimestamp,
    date,
    applied,
    message,
    shiftLabel,
    reason,
    originalTimestamp: input.actionTime.toISOString(),
    roundedTimestamp: roundedTimestamp.toISOString(),
  };
}
