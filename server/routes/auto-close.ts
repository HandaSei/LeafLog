import { differenceInMinutes, format } from "date-fns";
import { storage } from "../storage";
import { broadcastEntryUpdate } from "../sse";

const autoCloseCache = new Map<number, number>();
const AUTO_CLOSE_CACHE_TTL_MS = 2 * 60 * 1000;

export async function autoCloseStaleSession(employeeId: number): Promise<void> {
  const cacheNow = Date.now();
  const lastCheck = autoCloseCache.get(employeeId);
  if (lastCheck && cacheNow - lastCheck < AUTO_CLOSE_CACHE_TTL_MS) {
    return;
  }
  autoCloseCache.set(employeeId, cacheNow);

  const openDate = await storage.getOpenSessionDate(employeeId);
  if (!openDate) return;

  const entries = await storage.getTimeEntriesByEmployeeAndDate(employeeId, openDate);
  const clockIns = entries.filter((e) => e.type === "clock-in");
  if (clockIns.length === 0) return;

  const lastClockIn = clockIns[clockIns.length - 1];
  const lastClockInTime = new Date(lastClockIn.timestamp);
  const now = new Date();
  const hoursOpen = differenceInMinutes(now, lastClockInTime) / 60;

  const breakAfter10h = entries.some(
    (e) =>
      e.type === "break-start" &&
      new Date(e.timestamp).getTime() > lastClockInTime.getTime() + 10 * 60 * 60 * 1000
  );
  const limitHours = breakAfter10h ? 24 : 16;

  if (hoursOpen > limitHours) {
    const closeTime = new Date(lastClockInTime.getTime() + limitHours * 60 * 60 * 1000);
    const closeDate = format(closeTime, "yyyy-MM-dd");
    await storage.createTimeEntryManual(
      employeeId,
      "clock-out",
      closeDate,
      closeTime,
      null,
      `auto-closed after ${limitHours}h`,
      false,
      "auto-close"
    );
    broadcastEntryUpdate(employeeId, { type: "clock-out", timestamp: closeTime.toISOString(), source: "auto-close" });
  }
}
