import { useEffect, useState } from "react";

function msUntilNextLocalDay() {
  const now = new Date();
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 2, 0);
  return Math.max(1000, nextDay.getTime() - now.getTime());
}

export function useToday() {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    let timeoutId: number | undefined;

    const refresh = () => {
      setToday(new Date());
      timeoutId = window.setTimeout(refresh, msUntilNextLocalDay());
    };

    timeoutId = window.setTimeout(refresh, msUntilNextLocalDay());

    const handleResume = () => setToday(new Date());
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
