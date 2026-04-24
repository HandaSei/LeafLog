import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.() ? 'https://leaflog.org' : '');

// Event emitter for auth errors (session expiry)
type AuthErrorHandler = () => void;
const authErrorHandlers: AuthErrorHandler[] = [];

export function onAuthError(handler: AuthErrorHandler) {
  authErrorHandlers.push(handler);
  return () => {
    const index = authErrorHandlers.indexOf(handler);
    if (index > -1) authErrorHandlers.splice(index, 1);
  };
}

function emitAuthError() {
  authErrorHandlers.forEach(handler => handler());
}

// Best-effort housekeeping endpoints. A 401 on these MUST NOT cascade into a
// forced global logout — they fire frequently (heartbeats, polls) and can race
// with intentional session changes (e.g. exiting SteepIn mode).
const SILENT_AUTH_ERROR_PREFIXES = [
  "/api/devices/check",
  "/api/devices/register",
  "/api/auth/steepin-restore",
];

function shouldSilenceAuthErrorFor(url: string): boolean {
  // Parse out the pathname so the silence list is matched as an exact path
  // prefix (not anywhere in the string). url may be relative ("/api/x") or
  // absolute ("https://host/api/x"); URL() needs a base for relative input.
  let pathname: string;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    pathname = new URL(url, base).pathname;
  } catch {
    pathname = url;
  }
  return SILENT_AUTH_ERROR_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "?") || pathname.startsWith(p + "/"),
  );
}

async function throwIfResNotOk(res: Response, urlForAuthCheck?: string) {
  if (!res.ok) {
    // Detect 401 Unauthorized - session expired
    if (res.status === 401 && !(urlForAuthCheck && shouldSilenceAuthErrorFor(urlForAuthCheck))) {
      emitAuthError();
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE_URL}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res, url);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/");
    const res = await fetch(`${API_BASE_URL}${url}`, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      if (!shouldSilenceAuthErrorFor(url)) emitAuthError();
      return null;
    }

    await throwIfResNotOk(res, url);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes - longer to use bootstrap data effectively
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
