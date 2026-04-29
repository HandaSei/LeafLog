import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE_URL } from "@/lib/api-base";

interface UseEntriesSyncOptions {
  employeeId: number | null | undefined;
  onUpdateDetected: () => void | Promise<void>;
  enabled?: boolean;
}

interface SSEStatus {
  isConnected: boolean;
}

export function useEntriesSync({
  employeeId,
  onUpdateDetected,
  enabled = true,
}: UseEntriesSyncOptions): SSEStatus {
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isProcessingRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUpdateRef = useRef(onUpdateDetected);
  onUpdateRef.current = onUpdateDetected;

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
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
    let isMounted = true;

    function connect() {
      if (!isMounted) return;

      if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
        return;
      }

      cleanup();

      const url = `${API_BASE_URL}/api/steepin/entries/${employeeId}/stream`;
      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!isMounted) return;
        setIsConnected(true);
        retryDelay = 2000;
      };

      es.addEventListener("entry-update", async () => {
        if (!isMounted || isProcessingRef.current) return;
        isProcessingRef.current = true;
        try {
          await onUpdateRef.current();
        } finally {
          isProcessingRef.current = false;
        }
      });

      es.onerror = () => {
        if (!isMounted) return;
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
