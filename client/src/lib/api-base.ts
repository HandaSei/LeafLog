export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()
    ? "https://leaflog.org"
    : "");
