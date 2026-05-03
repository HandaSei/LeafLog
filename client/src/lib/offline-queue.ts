import { queryClient } from "./queryClient";
import { API_BASE_URL } from "@/lib/api-base";

const QUEUE_KEY = "leaflog_pending_actions";
const ENTRIES_CACHE_KEY = "leaflog_steepin_entries_cache";

export interface QueuedAction {
  id: string;
  employeeId: number;
  type: string;
  passcode: string;
  notes?: string;
  timestamp: string;
  date: string;
}

export function getQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToQueue(
  action: Omit<QueuedAction, "id">,
): QueuedAction {
  const queued: QueuedAction = {
    ...action,
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  const queue = getQueue();
  queue.push(queued);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return queued;
}

export function removeFromQueue(id: string) {
  const queue = getQueue().filter((a) => a.id !== id);
  if (queue.length === 0) {
    localStorage.removeItem(QUEUE_KEY);
  } else {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
}

export function getQueueCountForEmployee(employeeId: number): number {
  return getQueue().filter((a) => a.employeeId === employeeId).length;
}

export function cacheEntries(employeeId: number, entries: unknown[]) {
  try {
    const map = getEntriesMap();
    map[employeeId.toString()] = entries;
    localStorage.setItem(ENTRIES_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

export function getCachedEntries(employeeId: number): unknown[] | undefined {
  try {
    const map = getEntriesMap();
    return map[employeeId.toString()];
  } catch {
    return undefined;
  }
}

function getEntriesMap(): Record<string, unknown[]> {
  try {
    const raw = localStorage.getItem(ENTRIES_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error && /fetch|network|abort|timeout/i.test(error.message)) return true;
  return !navigator.onLine;
}

export function shouldQueueAction(error: unknown): boolean {
  return isNetworkError(error);
}

export async function processQueue(
  onProcessed?: (action: QueuedAction, success: boolean, errorMessage?: string) => void,
): Promise<number> {
  if (!navigator.onLine) return 0;
  const queue = getQueue();
  if (queue.length === 0) return 0;

  let processed = 0;
  for (const action of queue) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/steepin/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: action.employeeId,
          type: action.type,
          passcode: action.passcode,
          notes: action.notes,
          offlineTimestamp: action.timestamp,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const key = ["/api/steepin/entries", action.employeeId.toString()];

        removeFromQueue(action.id);
        processed++;

        if (data && Array.isArray(data.entries)) {
          queryClient.setQueryData(key, data.entries);
          cacheEntries(action.employeeId, data.entries);
        } else {
          queryClient.invalidateQueries({ queryKey: key });
        }

        onProcessed?.(action, true);
      } else if (res.status === 409) {
        // Conflict - action was invalid (e.g., clock-out when already clocked out)
        // Remove from queue and notify user
        removeFromQueue(action.id);
        const errorData = await res.json().catch(() => ({ message: "Action conflicted with server state" }));
        onProcessed?.(action, false, errorData.message);
      } else if (res.status === 401) {
        // Kiosk session may be transiently expired (sleep/wake, sw update,
        // network change). Keep queued actions so they can retry once the
        // long-lived session is restored, instead of silently dropping them.
        break;
      } else if (res.status === 403) {
        const errorData = await res.json().catch(() => ({ message: "Access denied" }));
        if (errorData.message === "Employee is archived") {
          removeFromQueue(action.id);
          onProcessed?.(action, false, errorData.message);
        } else {
          // Treat other 403s as transient auth issues, same rationale as 401.
          break;
        }
      } else if (res.status >= 400 && res.status < 500) {
        removeFromQueue(action.id);
        onProcessed?.(action, false);
      }
    } catch {
      break;
    }
  }

  return processed;
}
