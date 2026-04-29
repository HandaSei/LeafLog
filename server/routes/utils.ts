import type { Request } from "express";
import { format } from "date-fns";

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type RecentEntryRow = {
  id: number;
  employee_id: number;
  type: string;
  timestamp: Date;
  date: string;
  source: string | null;
};

export function getDateRangeQuery(req: Request) {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  if (!from && !to) return null;
  if (!from || !to || !DATE_ONLY_RE.test(from) || !DATE_ONLY_RE.test(to) || from > to) {
    return { error: "Valid from and to dates are required" } as const;
  }
  return { from, to } as const;
}

export function toDateOnly(value: string | Date): string {
  return value instanceof Date ? format(value, "yyyy-MM-dd") : value.substring(0, 10);
}
