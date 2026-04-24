import { queryClient } from "./queryClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.() ? 'https://leaflog.org' : '');

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

// In-memory mirror of the entries map so reads are always fresh and
// writes can be safely deferred to idle time. Without the mirror, two
// rapid cacheEntries() calls would race: each would read the *stale*
// localStorage map, mutate its own copy, and the second deferred write
// would clobber the first employee's entries.
let entriesMapMirror: Record<string, unknown[]> | null = null;

function loadEntriesMap(): Record<string, unknown[]> {
  if (entriesMapMirror !== null) return entriesMapMirror;
  try {
    const raw = localStorage.getItem(ENTRIES_CACHE_KEY);
    entriesMapMirror = raw ? JSON.parse(raw) : {};
  } catch {
    entriesMapMirror = {};
  }
  return entriesMapMirror!;
}

export function cacheEntries(employeeId: number, entries: unknown[]) {
  const map = loadEntriesMap();
  map[employeeId.toString()] = entries;
  // Defer the JSON.stringify + setItem (~10-25ms on cheap Android) to
  // browser idle time. The map closure captures by reference, so when
  // idle fires it serializes the latest state of all mutations.
  idleWrite(ENTRIES_CACHE_KEY, () => {
    try {
      localStorage.setItem(ENTRIES_CACHE_KEY, JSON.stringify(map));
    } catch {}
  });
}

export function getCachedEntries(employeeId: number): unknown[] | undefined {
  const map = loadEntriesMap();
  return map[employeeId.toString()];
}

// ----------------------------------------------------------------
// Idle-deferred write helpers
// ----------------------------------------------------------------
// Wraps localStorage writes (or any cheap-but-blocking work) so they
// happen during browser idle time instead of stealing tap-response
// budget. Writes are deduped by key — only the LATEST scheduled write
// per key actually runs when idle fires. A pagehide/visibilitychange
// listener flushes everything so we never lose state on tab close.

type IdleHandle = number;
let idleHandle: IdleHandle | null = null;
const pendingWrites = new Map<string, () => void>();

function scheduleFlush() {
  if (idleHandle != null) return;
  const flush = () => {
    idleHandle = null;
    const tasks = Array.from(pendingWrites.values());
    pendingWrites.clear();
    for (const task of tasks) {
      try { task(); } catch {}
    }
  };
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function") {
    idleHandle = w.requestIdleCallback(flush, { timeout: 2000 });
  } else {
    // Safari/older Android WebView fallback.
    idleHandle = setTimeout(flush, 0) as unknown as number;
  }
}

export function idleWrite(key: string, write: () => void) {
  pendingWrites.set(key, write);
  scheduleFlush();
}

export function flushIdleWrites() {
  if (idleHandle != null) {
    const w = window as Window & { cancelIdleCallback?: (h: number) => void };
    if (typeof w.cancelIdleCallback === "function") {
      try { w.cancelIdleCallback(idleHandle); } catch {}
    } else {
      clearTimeout(idleHandle);
    }
    idleHandle = null;
  }
  const tasks = Array.from(pendingWrites.values());
  pendingWrites.clear();
  for (const task of tasks) {
    try { task(); } catch {}
  }
}

// One-time install: flush pending idle writes when the page is being
// hidden (tab switch, navigation, app backgrounded on Capacitor) so
// the latest cache state is durable even if the kiosk is closed mid-tap.
if (typeof window !== "undefined") {
  let installed = (window as Window & { __leaflogIdleFlushInstalled?: boolean }).__leaflogIdleFlushInstalled;
  if (!installed) {
    (window as Window & { __leaflogIdleFlushInstalled?: boolean }).__leaflogIdleFlushInstalled = true;
    window.addEventListener("pagehide", flushIdleWrites);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushIdleWrites();
    });
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
        removeFromQueue(action.id);
        processed++;
        queryClient.invalidateQueries({
          queryKey: ["/api/steepin/entries", action.employeeId.toString()],
        });
        onProcessed?.(action, true);
      } else if (res.status === 409) {
        // Conflict - action was invalid (e.g., clock-out when already clocked out)
        // Remove from queue and notify user
        removeFromQueue(action.id);
        const errorData = await res.json().catch(() => ({ message: "Action conflicted with server state" }));
        onProcessed?.(action, false, errorData.message);
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
