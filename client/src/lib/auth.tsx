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
}

interface AuthContextType {
  user: AuthUser | null;
  employee: any | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isEmployee: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginWithCode: (code: string) => Promise<void>;
  registerManager: (username: string, password: string, agencyName: string) => Promise<void>;
  logout: () => Promise<void>;
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

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const login = useCallback(async (username: string, password: string) => {
    await loginMutation.mutateAsync({ username, password });
    
    // Store credentials for SteepIn persistence if requested
    const params = new URLSearchParams(window.location.search);
    if (params.get("redirect")?.includes("SteepIn")) {
      localStorage.setItem("steepin_session", btoa(`${username}:${password}`));
    }
  }, [loginMutation]);

  const loginWithCode = useCallback(async (code: string) => {
    await codeMutation.mutateAsync(code);
  }, []);

  const registerManager = useCallback(async (username: string, password: string, agencyName: string) => {
    await registerMutation.mutateAsync({ username, password, agencyName });
  }, []);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, []);

  const user = authState?.authenticated ? authState.user : null;

  const value: AuthContextType = {
    user,
    employee: authState?.employee || null,
    isAuthenticated: !!authState?.authenticated,
    isLoading,
    isAdmin: user?.role === "admin",
    isManager: user?.role === "manager",
    isEmployee: user?.role === "employee",
    login,
    loginWithCode,
    registerManager,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
