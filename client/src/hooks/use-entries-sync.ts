import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE_URL } from "@/lib/api-base";

interface UseEntriesSyncOptions {
  employeeId: number | null | undefined;
  onUpdateDetected: () => void | Promise<void>;
  onConnected?: () => void | Promise<void>;
  enabled?: boolean;
}

interface SSEStatus {
  isConnected: boolean;
}

export function useEntriesSync({
  employeeId,
  onUpdateDetected,
  onConnected,
  enabled = true,
}: UseEntriesSyncOptions): SSEStatus {
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isProcessingRef = useRef(false);
  const pendingUpdateRef = useRef(false);
  const pendingConnectedRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventAtRef = useRef(Date.now());
  const onUpdateRef = useRef(onUpdateDetected);
  const onConnectedRef = useRef(onConnected);
  onUpdateRef.current = onUpdateDetected;
  onConnectedRef.current = onConnected;

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (watchdogIntervalRef.current) {
      clearInterval(watchdogIntervalRef.current);
      watchdogIntervalRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    pendingUpdateRef.current = false;
    pendingConnectedRef.current = false;
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      console.debug("[useEntriesSync] EventSource not available, skipping SSE");
      return;
    }

    if (!enabled || !employeeId || !navigator.onLine) {
      cleanup();
      return;
    }

    let retryDelay = 2000;
    const maxRetryDelay = 30000;
    const streamStaleAfterMs = 75000;
    let isMounted = true;

    const markEventReceived = () => {
      lastEventAtRef.current = Date.now();
    };

    const processRefresh = async (
      initialRefresh: () => void | Promise<void>,
      pendingType: "update" | "connected",
    ) => {
      if (!isMounted) return;

      if (isProcessingRef.current) {
        if (pendingType === "update") {
          pendingUpdateRef.current = true;
        } else {
          pendingConnectedRef.current = true;
        }
        return;
      }

      isProcessingRef.current = true;

      try {
        let refresh = initialRefresh;
        while (isMounted) {
          pendingUpdateRef.current = false;
          pendingConnectedRef.current = false;

          try {
            await refresh();
          } catch (error) {
            console.debug("[useEntriesSync] Update refresh failed:", error);
          }

          if (pendingUpdateRef.current) {
            refresh = onUpdateRef.current;
            continue;
          }

          if (pendingConnectedRef.current && onConnectedRef.current) {
            refresh = onConnectedRef.current;
            continue;
          }

          break;
        }
      } finally {
        isProcessingRef.current = false;
      }
    };

    const processUpdate = () => processRefresh(onUpdateRef.current, "update");

    const startWatchdog = () => {
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
      }
      watchdogIntervalRef.current = setInterval(() => {
        if (!isMounted || !navigator.onLine) return;
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) return;

        const msSinceEvent = Date.now() - lastEventAtRef.current;
        if (msSinceEvent < streamStaleAfterMs) return;

        console.debug("[useEntriesSync] SSE stream stale, reconnecting...");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
        connect();
      }, 30000);
    };

    function connect() {
      if (!isMounted) return;

      if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
        return;
      }

      cleanup();

      const url = `${API_BASE_URL}/api/steepin/entries/${employeeId}/stream`;
      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;
      markEventReceived();
      startWatchdog();

      es.onopen = () => {
        if (!isMounted || eventSourceRef.current !== es) return;
        markEventReceived();
        setIsConnected(true);
        retryDelay = 2000;
        if (onConnectedRef.current) {
          void processRefresh(onConnectedRef.current, "connected");
        }
      };

      es.addEventListener("connected", () => {
        if (!isMounted || eventSourceRef.current !== es) return;
        markEventReceived();
      });

      es.addEventListener("heartbeat", () => {
        if (!isMounted || eventSourceRef.current !== es) return;
        markEventReceived();
      });

      es.addEventListener("entry-update", () => {
        if (!isMounted || eventSourceRef.current !== es) return;
        markEventReceived();
        void processUpdate();
      });

      es.onerror = () => {
        if (!isMounted || eventSourceRef.current !== es) return;
        setIsConnected(false);
        es.close();
        eventSourceRef.current = null;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (isMounted && navigator.onLine) {
            connect();
          }
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 1.5, maxRetryDelay);
      };
    }

    connect();

    const handleOnline = () => {
      if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
        connect();
      }
    };
    const handleOffline = () => {
      cleanup();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      isMounted = false;
      cleanup();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [employeeId, enabled, cleanup]);

  return { isConnected };
}
