import { useEffect } from "react";
import { API_BASE_URL } from "@/lib/api-base";
import { queryClient } from "@/lib/queryClient";

interface ManagerLiveUpdate {
  type?: string;
}

export function useManagerLiveSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    let pendingEntries = false;
    let pendingShifts = false;
    let pendingEmployees = false;
    let flushTimer: number | undefined;
    const stream = new EventSource(`${API_BASE_URL}/api/manager/stream`, {
      withCredentials: true,
    });

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

    stream.addEventListener("manager-update", (event) => {
      let data: ManagerLiveUpdate;
      try {
        data = JSON.parse(event.data);
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

    return () => {
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      stream.close();
    };
  }, [enabled]);
}
