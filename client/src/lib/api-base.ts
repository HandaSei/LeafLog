function normalizeApiBaseUrl(value: string | undefined) {
  if (!value) return "";
  const trimmed = value.trim().replace(/\/+$/, "");
  // The client already sends paths like /api/auth/me. If someone configures
  // VITE_API_BASE_URL with a trailing /api, every request becomes /api/api/...
  // and the server answers with the app's HTML 404 page.
  return trimmed.replace(/\/api$/i, "");
}

export const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()
    ? "https://leaflog.org"
    : ""),
);
