import { createContext, useContext, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

async function fetchBootstrap() {
  const res = await fetch("/api/bootstrap", { credentials: "include" });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.employees !== undefined) {
    queryClient.setQueryData(["/api/employees"], data.employees);
    const activeEmps = data.employees.filter((e: any) => e.status === "active");
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
  if (data.steepinEntries) {
    for (const [empId, entries] of Object.entries(data.steepinEntries)) {
      queryClient.setQueryData(["/api/steepin/entries", empId], entries);
    }
  }
  return data.auth ?? null;
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
  registerManager: (username: string, password: string, email: string, agencyName: string) => Promise<any>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  upgradeEmployee: (username: string, password: string, email: string) => Promise<any>;
  verifyEmployeeUpgrade: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  exitSteepIn: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: authState, isLoading } = useQuery<AuthState | null>({
    queryKey: ["/api/auth/me"],
    queryFn: fetchBootstrap,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", { username, password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const steepinLoginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/steepin-login", { username, password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const codeMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/access-code", { code });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async ({ username, password, email, agencyName }: { username: string; password: string; email: string; agencyName: string }) => {
      const res = await apiRequest("POST", "/api/auth/register-manager", { username, password, email, agencyName });
      return res.json();
    },
  });

  const verifyEmailMutation = useMutation({
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      const res = await apiRequest("POST", "/api/auth/verify-email", { email, code });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const exitSteepInMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/steepin-exit");
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
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

  const registerManager = useCallback(async (username: string, password: string, email: string, agencyName: string) => {
    return await registerMutation.mutateAsync({ username, password, email, agencyName });
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

  const exitSteepIn = useCallback(async () => {
    await exitSteepInMutation.mutateAsync();
  }, [exitSteepInMutation]);

  const user = authState?.authenticated ? authState.user : null;
  const isShadow = !!user && user.role === "employee" && user.username.startsWith("emp_");

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
