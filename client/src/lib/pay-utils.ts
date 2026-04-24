import type { Employee } from "@shared/schema";

interface CustomPayDay {
  date: string;
  rate: string;
}

function parseCustomDays(raw: string | null | undefined): CustomPayDay[] {
  try {
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function getEffectiveRate(
  employee: Employee,
  dateStr: string,
  weeklyHoursBeforeThisDay: number,
): { rate: number; isOvertime: boolean; isSpecialDay: boolean; isCustomDay: boolean } {
  const baseRate = parseFloat(employee.hourlyRate || "0");
  const thresholdOnly = employee.tierThresholdOnly ?? false;

  if (!thresholdOnly && baseRate === 0) return { rate: 0, isOvertime: false, isSpecialDay: false, isCustomDay: false };

  const customDays = parseCustomDays(employee.customPayDays);
  const customMatch = customDays.find(d => d.date === dateStr);
  if (customMatch) {
    return { rate: parseFloat(customMatch.rate), isOvertime: false, isSpecialDay: false, isCustomDay: true };
  }

  if (employee.specialDayEnabled && employee.specialDayRate && employee.specialDayOfWeek != null) {
    const dayOfWeek = new Date(dateStr + "T12:00:00").getDay();
    if (dayOfWeek === employee.specialDayOfWeek) {
      return { rate: parseFloat(employee.specialDayRate), isOvertime: false, isSpecialDay: true, isCustomDay: false };
    }
  }

  if (employee.tierEnabled && employee.tierHoursThreshold && employee.tierOvertimeRate) {
    if (weeklyHoursBeforeThisDay >= employee.tierHoursThreshold) {
      return { rate: parseFloat(employee.tierOvertimeRate), isOvertime: true, isSpecialDay: false, isCustomDay: false };
    }
  }

  return { rate: thresholdOnly ? 0 : baseRate, isOvertime: false, isSpecialDay: false, isCustomDay: false };
}

export function calculateDayPay(
  employee: Employee,
  dateStr: string,
  hoursWorked: number,
  weeklyHoursBeforeThisDay: number,
): number {
  const baseRate = parseFloat(employee.hourlyRate || "0");
  const thresholdOnly = employee.tierThresholdOnly ?? false;

  if (!thresholdOnly && baseRate === 0) return 0;
  if (thresholdOnly && !employee.tierEnabled) return 0;

  const customDays = parseCustomDays(employee.customPayDays);
  const customMatch = customDays.find(d => d.date === dateStr);
  if (customMatch) {
    return hoursWorked * parseFloat(customMatch.rate);
  }

  if (employee.specialDayEnabled && employee.specialDayRate && employee.specialDayOfWeek != null) {
    const dayOfWeek = new Date(dateStr + "T12:00:00").getDay();
    if (dayOfWeek === employee.specialDayOfWeek) {
      return hoursWorked * parseFloat(employee.specialDayRate);
    }
  }

  if (thresholdOnly && employee.tierEnabled && employee.tierHoursThreshold && employee.tierOvertimeRate) {
    const threshold = employee.tierHoursThreshold;
    const secondaryRate = parseFloat(employee.tierOvertimeRate);

    if (weeklyHoursBeforeThisDay >= threshold) {
      return hoursWorked * secondaryRate;
    }

    const remainingBeforeThreshold = Math.max(0, threshold - weeklyHoursBeforeThisDay);
    if (hoursWorked <= remainingBeforeThreshold) {
      return 0;
    }

    const paidHours = hoursWorked - remainingBeforeThreshold;
    return paidHours * secondaryRate;
  }

  if (employee.tierEnabled && employee.tierHoursThreshold && employee.tierOvertimeRate) {
    const threshold = employee.tierHoursThreshold;
    const overtimeRate = parseFloat(employee.tierOvertimeRate);

    if (weeklyHoursBeforeThisDay >= threshold) {
      return hoursWorked * overtimeRate;
    }

    const remainingRegular = Math.max(0, threshold - weeklyHoursBeforeThisDay);
    if (hoursWorked <= remainingRegular) {
      return hoursWorked * baseRate;
    }

    const regularPortion = remainingRegular;
    const overtimePortion = hoursWorked - remainingRegular;
    return (regularPortion * baseRate) + (overtimePortion * overtimeRate);
  }

  return thresholdOnly ? 0 : hoursWorked * baseRate;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function hasPayConfig(employee: Employee): boolean {
  return !!(employee.hourlyRate && parseFloat(employee.hourlyRate) > 0) || !!(employee.tierThresholdOnly && employee.tierEnabled);
}
