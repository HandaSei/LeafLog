import { createContext, useContext, useCallback, useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, onAuthError } from "@/lib/queryClient";
import { isActiveUnarchivedEmployee } from "@/lib/employees";
import { API_BASE_URL } from "@/lib/api-base";
import { getDeviceName, getOrCreateDeviceId } from "@/lib/device";
import type { PaidTrialTierId } from "@shared/subscription";
const AUTH_CACHE_KEY = "leaflog_auth_state";
const BOOTSTRAP_TIMEOUT_MS = 5000; // 5 second timeout for bootstrap
const VERIFICATION_TIMEOUT_MS = 2500; // 2.5s for background verification - faster initial render
const AUTH_CACHE_VERSION = 1;
const LONG_LIVED_AUTH_CACHE_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years
const STANDARD_AUTH_CACHE_MAX_AGE_MS = LONG_LIVED_AUTH_CACHE_MAX_AGE_MS;
const STEEPIN_AUTH_CACHE_MAX_AGE_MS = LONG_LIVED_AUTH_CACHE_MAX_AGE_MS;

interface CachedAuthEnvelope {
  version: number;
  auth: AuthState;
  expiresAt: number;
}

function isAuthState(value: unknown): value is AuthState {
  return !!value && typeof value === "object" && "authenticated" in value;
}

function getAuthCacheMaxAge(auth: AuthState) {
  return auth.steepinMode ? STEEPIN_AUTH_CACHE_MAX_AGE_MS : STANDARD_AUTH_CACHE_MAX_AGE_MS;
}

function readCachedAuth(): AuthState | null | undefined {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object" && "auth" in parsed && "expiresAt" in parsed) {
      const envelope = parsed as CachedAuthEnvelope;
      if (typeof envelope.expiresAt === "number" && Date.now() > envelope.expiresAt) {
        localStorage.removeItem(AUTH_CACHE_KEY);
        return undefined;
      }
      return isAuthState(envelope.auth) ? envelope.auth : undefined;
    }

    // Backward compatibility for pre-expiry auth cache. Bootstrap will verify
    // it in the background and rewrite it with an expiry if it is still valid.
    return isAuthState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function saveCachedAuth(auth: AuthState | null) {
  try {
    if (auth) {
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
        version: AUTH_CACHE_VERSION,
        auth,
        expiresAt: Date.now() + getAuthCacheMaxAge(auth),
      }));
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {}
}

function toLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDashboardBootstrapDates() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return {
    today: toLocalDateString(today),
    yesterday: toLocalDateString(yesterday),
  };
}

async function attemptSteepinRestore(): Promise<boolean> {
  try {
    const deviceId = localStorage.getItem("leaflog_device_id");
    if (!deviceId) return false;
    const res = await fetch(`${API_BASE_URL}/api/auth/steepin-restore`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchBootstrapWithTimeout(retryCount = 0, timeoutMs = BOOTSTRAP_TIMEOUT_MS): Promise<AuthState | null> {
  // Prevent infinite retry loops (max 2 attempts)
  if (retryCount >= 2) {
    console.warn('[Auth] Max bootstrap retries reached, using cached auth');
    return readCachedAuth() ?? null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const dashboardDates = getDashboardBootstrapDates();
    const params = new URLSearchParams({
      dashboardToday: dashboardDates.today,
      dashboardYesterday: dashboardDates.yesterday,
    });
    const res = await fetch(`${API_BASE_URL}/api/bootstrap?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      const cached = readCachedAuth();
      return cached ?? null;
    }
    const data = await res.json();

    if (data.auth && !data.auth.authenticated) {
      const cachedAuth = readCachedAuth();
      if (cachedAuth?.steepinMode) {
        saveCachedAuth(null);
        const restored = await attemptSteepinRestore();
        if (restored) {
          // Retry with incremented counter to prevent infinite loop
          return fetchBootstrapWithTimeout(retryCount + 1);
        }
      }
    }

    if (data.employees !== undefined) {
      queryClient.setQueryData(["/api/employees"], data.employees);
      const activeEmps = data.employees.filter(isActiveUnarchivedEmployee);
      queryClient.setQueryData(["/api/steepin/employees"], activeEmps);
    }
    if (data.roles !== undefined) {
      queryClient.setQueryData(["/api/roles"], data.roles);
    }
    if (data.breakPolicy !== undefined) {
      queryClient.setQueryData(["/api/settings/break-policy"], data.breakPolicy);
    }
    if (data.notificationCount !== undefined) {
      queryClient.setQueryData(["/api/notifications/unread-count"], { count: data.notificationCount });
    }
    if (data.dashboard) {
      queryClient.setQueryData(
        ["/api/shifts", "range", data.dashboard.yesterday, data.dashboard.today],
        data.dashboard.shifts ?? [],
      );
      queryClient.setQueryData(
        ["/api/steepin/entries", "date", data.dashboard.today],
        data.dashboard.entries ?? [],
      );
      queryClient.setQueryData(
        ["/api/steepin/open-sessions"],
        data.dashboard.openSessionEntries ?? [],
      );
    }
    
    // Mark bootstrap data as fresh so pages don't refetch immediately
    queryClient.setQueryData(["/_bootstrap"], { timestamp: Date.now() });
    if (data.steepinEntries) {
      for (const [empId, entries] of Object.entries(data.steepinEntries)) {
        queryClient.setQueryData(["/api/steepin/entries", empId], entries);
      }
    }
    if (data.steepinThemeSettings) {
      try {
        localStorage.setItem("leaflog_steepin_theme", JSON.stringify(data.steepinThemeSettings));
      } catch {}
    }
    const auth = data.auth ?? null;
    if (auth?.authenticated) {
      queryClient.setQueryData(["/api/auth/me"], {
        ...auth,
        employees: data.employees,
        steepinEntries: data.steepinEntries,
      });
    } else {
      // Bootstrap says unauthenticated — clear any stale auth/me cache so consumers
      // (e.g. the SteepIn page) don't keep treating a dead session as active.
      queryClient.setQueryData(["/api/auth/me"], null);
    }
    saveCachedAuth(auth);
    if (auth && !auth.steepinMode) {
      try { localStorage.removeItem("leaflog_steepin_auth"); } catch {}
    }
    return auth;
  } catch (err) {
    clearTimeout(timeoutId);
    // If aborted due to timeout, still try to use cached auth
    const cached = readCachedAuth();
    return cached ?? null;
  }
}

interface AuthUser {
  id: number;
  username: string;
  role: string;
  employeeId: number | null;
  agencyName: string | null;
  email: string | null;
}

interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
  employee: any | null;
  steepinMode: boolean;
}

interface AuthEmailResult {
  requiresVerification?: boolean;
  email?: string;
  emailSent?: boolean;
  fallbackCode?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  employee: any | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isEmployee: boolean;
  isSteepIn: boolean;
  isShadowAccount: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginSteepIn: (username: string, password: string) => Promise<void>;
  loginWithCode: (code: string) => Promise<void>;
  registerManager: (username: string, password: string, email: string, agencyName: string, country?: string, subscriptionTier?: PaidTrialTierId) => Promise<AuthEmailResult>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<AuthEmailResult>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  upgradeEmployee: (username: string, password: string, email: string) => Promise<AuthEmailResult>;
  verifyEmployeeUpgrade: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  exitSteepIn: (username: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Read cached auth once on mount
  const cachedAuthRef = useRef(readCachedAuth());
  const didVerifyRef = useRef(false);
  
  // Start with cached auth if available, otherwise undefined (loading state)
  // This ensures first-load waits for verification, but returning users see UI immediately
  const [authState, setAuthState] = useState<AuthState | null | undefined>(() => {
    const cached = cachedAuthRef.current;
    // If we have cached auth, use it immediately for instant UI
    // If no cache, return undefined to show loading state during first verification
    return cached;
  });
  
  // Track if initial verification is complete
  const [isInitialVerificationComplete, setIsInitialVerificationComplete] = useState(!!cachedAuthRef.current);
  
  // Ref to track current auth state for comparison in background verification
  // Must be declared before the effect that uses it
  const authStateRef = useRef(authState);
  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  // Background verification effect on mount
  // Uses cached auth immediately for instant UI, verifies in background
  useEffect(() => {
    // Prevent double execution in React StrictMode
    if (didVerifyRef.current) return;
    didVerifyRef.current = true;
    
    let isMounted = true;
    
    async function verifyAuth() {
      try {
        // Use shorter timeout for background verification to not block UI
        // If server is slow, we still have cached auth to show
        const freshAuth = await fetchBootstrapWithTimeout(0, VERIFICATION_TIMEOUT_MS);
        
        if (!isMounted) return;
        
        // Only update state if auth actually changed to avoid unnecessary re-renders
        const currentAuth = authStateRef.current;
        const authChanged = 
          !currentAuth !== !freshAuth || // One is null, other isn't
          (currentAuth?.authenticated !== freshAuth?.authenticated) ||
          (currentAuth?.user?.id !== freshAuth?.user?.id) ||
          (currentAuth?.steepinMode !== freshAuth?.steepinMode);
        
        if (authChanged) {
          setAuthState(freshAuth);
        }
        setIsInitialVerificationComplete(true);
      } catch (error) {
        // On error, still mark verification as complete - cached auth remains usable
        if (isMounted) {
          setIsInitialVerificationComplete(true);
        }
      }
    }
    
    // Run verification in background - don't await
    verifyAuth();
    
    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for 401 auth errors from API calls and force logout
  useEffect(() => {
    const unsubscribe = onAuthError(() => {
      // Session expired on server - force logout
      if (authState?.authenticated) {
        console.warn('[Auth] Session expired, forcing logout');
        saveCachedAuth(null);
        try { localStorage.removeItem("leaflog_steepin_auth"); } catch {}
        queryClient.clear();
        setAuthState(null);
        setIsInitialVerificationComplete(true);
      }
    });
    
    return unsubscribe;
  }, [authState?.authenticated]);

  // Handle online/offline transitions
  useEffect(() => {
    let wasOffline = !navigator.onLine;
    
    const handleOnline = async () => {
      if (wasOffline) {
        console.log('[Auth] Connection restored, re-verifying auth...');
        wasOffline = false;
        // Re-verify auth when coming back online
        try {
          const freshAuth = await fetchBootstrapWithTimeout();
          setAuthState(freshAuth);
          // Refresh all cached queries
          queryClient.invalidateQueries({ queryKey: ['/api'] });
        } catch (error) {
          console.warn('[Auth] Failed to re-verify after coming online:', error);
        }
      }
    };
    
    const handleOffline = () => {
      console.log('[Auth] Connection lost');
      wasOffline = true;
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", { username, password });
      return res.json();
    },
    onSuccess: (data) => {
      saveCachedAuth(null);
      if (data?.user) {
        const authState: AuthState = {
          authenticated: true,
          user: data.user,
          employee: data.employee || null,
          steepinMode: false,
        };
        setAuthState(authState);
        saveCachedAuth(authState);
      }
    },
  });

  const steepinLoginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/steepin-login", {
        username,
        password,
        deviceId: getOrCreateDeviceId(),
        deviceName: getDeviceName(),
      });
      return res.json();
    },
    onSuccess: async () => {
      saveCachedAuth(null);
      const freshAuth = await fetchBootstrapWithTimeout();
      setAuthState(freshAuth);
    },
  });

  const codeMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/access-code", { code });
      return res.json();
    },
    onSuccess: async () => {
      saveCachedAuth(null);
      const freshAuth = await fetchBootstrapWithTimeout();
      setAuthState(freshAuth);
    },
  });

  const registerMutation = useMutation({
    mutationFn: async ({ username, password, email, agencyName, country, subscriptionTier }: { username: string; password: string; email: string; agencyName: string; country?: string; subscriptionTier?: PaidTrialTierId }) => {
      const res = await apiRequest("POST", "/api/auth/register-manager", { username, password, email, agencyName, country, subscriptionTier });
      return res.json();
    },
  });

  const verifyEmailMutation = useMutation({
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      const res = await apiRequest("POST", "/api/auth/verify-email", { email, code });
      return res.json();
    },
    onSuccess: async () => {
      const freshAuth = await fetchBootstrapWithTimeout();
      setAuthState(freshAuth);
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
      return res.json();
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ email, code, newPassword }: { email: string; code: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", { email, code, newPassword });
      return res.json();
    },
  });

  const upgradeEmployeeMutation = useMutation({
    mutationFn: async ({ username, password, email }: { username: string; password: string; email: string }) => {
      const res = await apiRequest("POST", "/api/auth/upgrade-employee", { username, password, email });
      return res.json();
    },
  });

  const verifyEmployeeUpgradeMutation = useMutation({
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      const res = await apiRequest("POST", "/api/auth/verify-employee-upgrade", { email, code });
      return res.json();
    },
    onSuccess: async () => {
      const freshAuth = await fetchBootstrapWithTimeout();
      setAuthState(freshAuth);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      saveCachedAuth(null);
      try { localStorage.removeItem("leaflog_steepin_auth"); } catch {}
      queryClient.clear();
      setAuthState(null);
    },
  });

  const exitSteepInMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      await apiRequest("POST", "/api/auth/steepin-exit", {
        username,
        password,
        deviceId: getOrCreateDeviceId(),
      });
    },
    onSuccess: () => {
      saveCachedAuth(null);
      try { localStorage.removeItem("leaflog_steepin_auth"); } catch {}
      queryClient.clear();
      setAuthState(null);
    },
  });

  const login = useCallback(async (username: string, password: string) => {
    await loginMutation.mutateAsync({ username, password });
  }, [loginMutation]);

  const loginSteepIn = useCallback(async (username: string, password: string) => {
    await steepinLoginMutation.mutateAsync({ username, password });
  }, [steepinLoginMutation]);

  const loginWithCode = useCallback(async (code: string) => {
    await codeMutation.mutateAsync(code);
  }, [codeMutation]);

  const registerManager = useCallback(async (username: string, password: string, email: string, agencyName: string, country?: string, subscriptionTier?: PaidTrialTierId) => {
    return await registerMutation.mutateAsync({ username, password, email, agencyName, country, subscriptionTier });
  }, [registerMutation]);

  const verifyEmail = useCallback(async (email: string, code: string) => {
    await verifyEmailMutation.mutateAsync({ email, code });
  }, [verifyEmailMutation]);

  const forgotPassword = useCallback(async (email: string) => {
    return await forgotPasswordMutation.mutateAsync(email);
  }, [forgotPasswordMutation]);

  const resetPassword = useCallback(async (email: string, code: string, newPassword: string) => {
    await resetPasswordMutation.mutateAsync({ email, code, newPassword });
  }, [resetPasswordMutation]);

  const upgradeEmployee = useCallback(async (username: string, password: string, email: string) => {
    return await upgradeEmployeeMutation.mutateAsync({ username, password, email });
  }, [upgradeEmployeeMutation]);

  const verifyEmployeeUpgrade = useCallback(async (email: string, code: string) => {
    await verifyEmployeeUpgradeMutation.mutateAsync({ email, code });
  }, [verifyEmployeeUpgradeMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const exitSteepIn = useCallback(async (username: string, password: string) => {
    await exitSteepInMutation.mutateAsync({ username, password });
  }, [exitSteepInMutation]);

  const user = authState?.authenticated ? authState.user : null;
  const isShadow = !!user && user.role === "employee" && user.username.startsWith("emp_");
  
  // isLoading is true only during initial verification when no cached auth exists
  // This prevents redirect flashes on first load
  const isLoading = !isInitialVerificationComplete && authState === undefined;

  const value: AuthContextType = {
    user,
    employee: authState?.employee || null,
    isAuthenticated: !!authState?.authenticated,
    isLoading,
    isAdmin: user?.role === "admin",
    isManager: user?.role === "manager",
    isEmployee: user?.role === "employee",
    isSteepIn: !!authState?.steepinMode,
    isShadowAccount: isShadow,
    login,
    loginSteepIn,
    loginWithCode,
    registerManager,
    verifyEmail,
    forgotPassword,
    resetPassword,
    upgradeEmployee,
    verifyEmployeeUpgrade,
    logout,
    exitSteepIn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
