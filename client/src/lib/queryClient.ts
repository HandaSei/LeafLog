import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api-base";

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

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Detect 401 Unauthorized - session expired
    if (res.status === 401) {
      emitAuthError();
    }
    const text = (await res.text()) || res.statusText;
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed?.message ? `${res.status}: ${parsed.message}` : `${res.status}: ${text}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`${res.status}:`)) {
          throw error;
        }
      }
    }

    if (/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
      throw new Error(`${res.status}: Server route not found for ${res.url}. Please check the API URL/deployment.`);
    }

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

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE_URL}${queryKey.join("/")}`, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      emitAuthError();
      return null;
    }

    await throwIfResNotOk(res);
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
