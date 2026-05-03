import { useEffect, useState } from "react";

function msUntilNextLocalDay() {
  const now = new Date();
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 2, 0);
  return Math.max(1000, nextDay.getTime() - now.getTime());
}

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function useToday() {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    let timeoutId: number | undefined;

    // Only emit a new Date when the local YYYY-MM-DD has actually changed,
    // so consumers' useMemo([today]) deps don't invalidate on every focus.
    const maybeUpdate = () => {
      setToday((prev) => {
        const next = new Date();
        return localDateKey(prev) === localDateKey(next) ? prev : next;
      });
    };

    const scheduleNext = () => {
      timeoutId = window.setTimeout(() => {
        maybeUpdate();
        scheduleNext();
      }, msUntilNextLocalDay());
    };

    scheduleNext();

    const handleResume = () => maybeUpdate();
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, []);

  return today;
}
