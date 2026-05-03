import { useEffect } from "react";
import { API_BASE_URL } from "@/lib/api-base";
import { queryClient } from "@/lib/queryClient";

interface ManagerLiveUpdate {
  type?: string;
}

const STREAM_STALE_AFTER_MS = 75000;
const WATCHDOG_INTERVAL_MS = 15000;

export function useManagerLiveSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    let pendingEntries = false;
    let pendingShifts = false;
    let pendingEmployees = false;
    let flushTimer: number | undefined;
    let watchdogInterval: number | undefined;
    let reconnectTimeout: number | undefined;
    let retryDelay = 2000;
    const maxRetryDelay = 30000;
    let stream: EventSource | null = null;
    let lastEventAt = Date.now();
    let cancelled = false;

    const flush = () => {
      flushTimer = undefined;
      if (pendingEntries) {
        pendingEntries = false;
        queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] });
        queryClient.invalidateQueries({ queryKey: ["/api/steepin/open-sessions"], exact: true });
      }
      if (pendingShifts) {
        pendingShifts = false;
        queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      }
      if (pendingEmployees) {
        pendingEmployees = false;
        queryClient.invalidateQueries({ queryKey: ["/api/employees"], exact: true });
        queryClient.invalidateQueries({ queryKey: ["/api/steepin/employees"], exact: true });
      }
    };

    const scheduleFlush = () => {
      if (flushTimer !== undefined) return;
      flushTimer = window.setTimeout(flush, 150);
    };

    const closeStream = () => {
      if (stream) {
        try { stream.close(); } catch {}
        stream = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimeout !== undefined) return;
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      closeStream();
      lastEventAt = Date.now();

      const es = new EventSource(`${API_BASE_URL}/api/manager/stream`, {
        withCredentials: true,
      });
      stream = es;

      es.onopen = () => {
        lastEventAt = Date.now();
        retryDelay = 2000;
        // Reconcile any state we may have missed during the disconnect.
        pendingEntries = true;
        pendingShifts = true;
        pendingEmployees = true;
        scheduleFlush();
      };

      es.addEventListener("heartbeat", () => {
        lastEventAt = Date.now();
      });

      es.addEventListener("connected", () => {
        lastEventAt = Date.now();
      });

      es.addEventListener("manager-update", (event) => {
        lastEventAt = Date.now();
        let data: ManagerLiveUpdate;
        try {
          data = JSON.parse((event as MessageEvent).data);
        } catch {
          return;
        }

        if (data.type === "entries-changed") {
          pendingEntries = true;
          scheduleFlush();
        } else if (data.type === "shifts-changed") {
          pendingShifts = true;
          scheduleFlush();
        } else if (data.type === "employees-changed") {
          pendingEmployees = true;
          scheduleFlush();
        }
      });

      es.onerror = () => {
        // EventSource will surface CONNECTING again on its own retry, but if
        // it lands in CLOSED we need to drive the reconnect ourselves.
        if (es.readyState === EventSource.CLOSED) {
          closeStream();
          scheduleReconnect();
        }
      };
    };

    const startWatchdog = () => {
      if (watchdogInterval !== undefined) return;
      watchdogInterval = window.setInterval(() => {
        if (cancelled) return;
        const sinceLast = Date.now() - lastEventAt;
        if (sinceLast > STREAM_STALE_AFTER_MS) {
          // Heartbeat (30s) hasn't landed in time — assume the stream is dead
          // even though the browser still thinks it's open.
          closeStream();
          scheduleReconnect();
        }
      }, WATCHDOG_INTERVAL_MS);
    };

    connect();
    startWatchdog();

    return () => {
      cancelled = true;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      if (reconnectTimeout !== undefined) window.clearTimeout(reconnectTimeout);
      if (watchdogInterval !== undefined) window.clearInterval(watchdogInterval);
      closeStream();
    };
  }, [enabled]);
}
