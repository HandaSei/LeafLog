import { useEffect, useRef, useCallback } from "react";

interface UseRefreshOnVisibilityOptions {
  /** Callback to trigger when visibility changes to visible */
  onVisible: () => void | Promise<void>;
  /** Minimum time in ms between refreshes to prevent spam (default: 2000ms) */
  minInterval?: number;
  /** Whether refreshing is currently enabled (e.g., online status) */
  enabled?: boolean;
}

/**
 * Hook that triggers a callback when the document becomes visible again.
 * Useful for refreshing data when user returns to the app after switching tabs/apps.
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

  const triggerRefresh = useCallback(async () => {
    if (!enabled || isRefreshingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;

    // Throttle: don't refresh more frequently than minInterval
    if (timeSinceLastRefresh < minInterval) {
      // Schedule a delayed refresh if we're in the throttle window
      const delay = minInterval - timeSinceLastRefresh;
      setTimeout(() => {
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          triggerRefresh();
        }
      }, delay);
      return;
    }

    isRefreshingRef.current = true;
    lastRefreshRef.current = now;
    pendingRefreshRef.current = false;

    try {
      await onVisible();
    } catch (error) {
      // Silent fail - let the query handle its own error state
      console.debug("[useRefreshOnVisibility] Refresh failed:", error);
    } finally {
      isRefreshingRef.current = false;
      // If a refresh was requested while we were refreshing, trigger it now
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        // Small delay to allow state to settle
        setTimeout(triggerRefresh, 100);
      }
    }
  }, [enabled, minInterval, onVisible]);

  useEffect(() => {
    // Skip if SSR
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh();
      }
    };

    // Also refresh when coming back online
    const handleOnline = () => {
      triggerRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [triggerRefresh]);

  // Expose a manual refresh function
  const manualRefresh = useCallback(() => {
    return triggerRefresh();
  }, [triggerRefresh]);

  return { manualRefresh };
}
