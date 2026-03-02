import { createContext, useContext, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

interface AuthUser {
  id: number;
  username: string;
  role: string;
  employeeId: number | null;
  agencyName: string | null;
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
  login: (username: string, password: string) => Promise<void>;
  loginSteepIn: (username: string, password: string) => Promise<void>;
  loginWithCode: (code: string) => Promise<void>;
  registerManager: (username: string, password: string, agencyName: string) => Promise<void>;
  registerAccount: (username: string, password: string, confirmPassword: string, email: string) => Promise<void>;
  logout: () => Promise<void>;
  exitSteepIn: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: authState, isLoading } = useQuery<AuthState>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 0,
    retry: false,
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
    mutationFn: async ({ username, password, agencyName }: { username: string; password: string; agencyName: string }) => {
      const res = await apiRequest("POST", "/api/auth/register-manager", { username, password, agencyName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const registerAccountMutation = useMutation({
    mutationFn: async ({ username, password, confirmPassword, email }: { username: string; password: string; confirmPassword: string; email: string }) => {
      const res = await apiRequest("POST", "/api/auth/register", { username, password, confirmPassword, email });
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

  const registerManager = useCallback(async (username: string, password: string, agencyName: string) => {
    await registerMutation.mutateAsync({ username, password, agencyName });
  }, [registerMutation]);

  const registerAccount = useCallback(async (username: string, password: string, confirmPassword: string, email: string) => {
    await registerAccountMutation.mutateAsync({ username, password, confirmPassword, email });
  }, [registerAccountMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const exitSteepIn = useCallback(async () => {
    await exitSteepInMutation.mutateAsync();
  }, [exitSteepInMutation]);

  const user = authState?.authenticated ? authState.user : null;

  const value: AuthContextType = {
    user,
    employee: authState?.employee || null,
    isAuthenticated: !!authState?.authenticated,
    isLoading,
    isAdmin: user?.role === "admin",
    isManager: user?.role === "manager",
    isEmployee: user?.role === "employee",
    isSteepIn: !!authState?.steepinMode,
    login,
    loginSteepIn,
    loginWithCode,
    registerManager,
    registerAccount,
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
