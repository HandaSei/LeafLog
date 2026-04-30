import { useEffect, useRef, useCallback } from "react";

export type VisibilityRefreshReason = "visible" | "online" | "focus" | "pageshow";

const refreshReasonPriority: Record<VisibilityRefreshReason, number> = {
  focus: 0,
  pageshow: 1,
  visible: 2,
  online: 3,
};

interface UseRefreshOnVisibilityOptions {
  /** Callback to trigger when the app may need fresh visible data */
  onVisible: (reason: VisibilityRefreshReason) => void | Promise<void>;
  /** Minimum time in ms between refreshes to prevent spam (default: 2000ms) */
  minInterval?: number;
  /** Whether refreshing is currently enabled (e.g., online status) */
  enabled?: boolean;
}

/**
 * Hook that triggers a callback when the document becomes visible again,
 * returns online, receives focus, or is restored from page cache.
 * 
 * Features:
 * - Throttles refreshes to prevent excessive API calls
 * - Respects online/offline status
 * - Handles rapid visibility changes gracefully
 * - Safe for SSR (checks for window/document existence)
 */
export function useRefreshOnVisibility({
  onVisible,
  minInterval = 2000,
  enabled = true,
}: UseRefreshOnVisibilityOptions) {
  const lastRefreshRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const pendingRefreshRef = useRef<boolean>(false);
  const pendingReasonRef = useRef<VisibilityRefreshReason | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
  }, []);

  const triggerRefresh = useCallback(async (reason: VisibilityRefreshReason) => {
    const rememberPendingReason = (nextReason: VisibilityRefreshReason) => {
      if (
        !pendingReasonRef.current ||
        refreshReasonPriority[nextReason] > refreshReasonPriority[pendingReasonRef.current]
      ) {
        pendingReasonRef.current = nextReason;
      }
    };

    if (!enabled) {
      pendingRefreshRef.current = false;
      pendingReasonRef.current = null;
      clearPendingTimeout();
      return;
    }

    if (isRefreshingRef.current) {
      pendingRefreshRef.current = true;
      rememberPendingReason(reason);
      return;
    }

    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;

    // Throttle: don't refresh more frequently than minInterval
    if (timeSinceLastRefresh < minInterval) {
      pendingRefreshRef.current = true;
      rememberPendingReason(reason);
      if (pendingTimeoutRef.current) return;

      // Schedule one delayed refresh if we're in the throttle window.
      const delay = minInterval - timeSinceLastRefresh;
      pendingTimeoutRef.current = setTimeout(() => {
        pendingTimeoutRef.current = null;
        if (pendingRefreshRef.current) {
          const nextReason = pendingReasonRef.current ?? reason;
          pendingRefreshRef.current = false;
          pendingReasonRef.current = null;
          void triggerRefresh(nextReason);
        }
      }, delay);
      return;
    }

    clearPendingTimeout();
    isRefreshingRef.current = true;
    lastRefreshRef.current = now;
    pendingRefreshRef.current = false;

    try {
      await onVisible(reason);
    } catch (error) {
      // Silent fail - let the query handle its own error state
      console.debug("[useRefreshOnVisibility] Refresh failed:", error);
    } finally {
      isRefreshingRef.current = false;
      // If a refresh was requested while we were refreshing, trigger it now
      if (pendingRefreshRef.current) {
        const nextReason = pendingReasonRef.current ?? reason;
        pendingRefreshRef.current = false;
        pendingReasonRef.current = null;
        // Small delay to allow state to settle
        pendingTimeoutRef.current = setTimeout(() => {
          pendingTimeoutRef.current = null;
          void triggerRefresh(nextReason);
        }, 100);
      }
    }
  }, [clearPendingTimeout, enabled, minInterval, onVisible]);

  useEffect(() => {
    if (enabled) return;
    pendingRefreshRef.current = false;
    pendingReasonRef.current = null;
    clearPendingTimeout();
  }, [clearPendingTimeout, enabled]);

  useEffect(() => {
    // Skip if SSR
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh("visible");
      }
    };

    // Also refresh when coming back online
    const handleOnline = () => {
      triggerRefresh("online");
    };

    const handleFocus = () => {
      triggerRefresh("focus");
    };

    const handlePageShow = () => {
      triggerRefresh("pageshow");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      clearPendingTimeout();
    };
  }, [clearPendingTimeout, triggerRefresh]);

  // Expose a manual refresh function
  const manualRefresh = useCallback(() => {
    return triggerRefresh("focus");
  }, [triggerRefresh]);

  return { manualRefresh };
}
