import { Switch, Route, Redirect } from "wouter";
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileHeader, MobileBottomNav } from "@/components/mobile-nav";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/error-boundary";
import { useManagerLiveSync } from "@/hooks/use-manager-live-sync";
import Dashboard from "@/pages/dashboard";

const LoginPage = lazy(() => import("@/pages/login"));

const loadSchedule = () => import("@/pages/schedule");
const loadEmployees = () => import("@/pages/employees");
const loadTimesheets = () => import("@/pages/timesheets");
const loadSettings = () => import("@/pages/settings");
const loadAdmin = () => import("@/pages/admin");

const Schedule = lazy(loadSchedule);
const Employees = lazy(loadEmployees);
const Timesheets = lazy(loadTimesheets);
const Settings = lazy(loadSettings);
const AdminPage = lazy(loadAdmin);
const NotFound = lazy(() => import("@/pages/not-found"));
const SteepInPage = lazy(() => import("@/pages/steepin"));

function PageFallback() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 180);
    return () => window.clearTimeout(id);
  }, []);

  if (!show) return null;
  return (
    <div className="fixed left-0 right-0 top-0 z-[100] h-0.5 overflow-hidden bg-primary/15">
      <div className="h-full w-1/3 animate-pulse bg-primary" />
    </div>
  );
}

function SteepInFallback() {
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: "#F0EDE6" }}>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/steepin-bg-watercolor.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
    </div>
  );
}

function AuthenticatedRouter() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/schedule" component={Schedule} />
        <Route path="/employees" component={Employees} />
        <Route path="/timesheets" component={Timesheets} />
        <Route path="/settings" component={Settings} />
        <Route path="/admin" component={AdminPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AuthenticatedLayout() {
  const { isAdmin, isManager } = useAuth();
  useManagerLiveSync(isAdmin || isManager);
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  useEffect(() => {
    const win = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const hasIdleCallback = typeof win.requestIdleCallback === "function";
    const timeoutIds: number[] = [];
    const idleIds: number[] = [];

    const schedulePrefetch = (callback: () => void, delayMs: number, idleTimeoutMs: number) => {
      const delayId = window.setTimeout(() => {
        if (hasIdleCallback) {
          idleIds.push(win.requestIdleCallback!(callback, { timeout: idleTimeoutMs }));
        } else {
          timeoutIds.push(window.setTimeout(callback, idleTimeoutMs));
        }
      }, delayMs);
      timeoutIds.push(delayId);
    };

    schedulePrefetch(() => {
      void loadSchedule();
      if (isAdmin || isManager) {
        void loadEmployees();
        void loadSettings();
      }
      if (isAdmin) void loadAdmin();
    }, 1200, 2000);

    schedulePrefetch(() => {
      if (isAdmin || isManager) void loadTimesheets();
    }, 3200, 3500);

    return () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
      if (hasIdleCallback && win.cancelIdleCallback) {
        idleIds.forEach((id) => win.cancelIdleCallback!(id));
      }
    };
  }, [isAdmin, isManager]);

  return (
    <SidebarProvider style={style as CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden" style={{ height: "100dvh" }}>
        <div className="hidden md:block">
          <AppSidebar />
        </div>

        <div className="flex flex-col flex-1 min-w-0">
          <MobileHeader />

          <header className="hidden md:flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-hidden pb-mobile-nav md:pb-0">
            <AuthenticatedRouter />
          </main>
        </div>
      </div>

      <MobileBottomNav />
    </SidebarProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, isSteepIn } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  if (isSteepIn) {
    return (
      <Suspense fallback={<SteepInFallback />}>
        <Switch>
          <Route path="/SteepIn" component={SteepInPage} />
          <Route><Redirect to="/SteepIn" /></Route>
        </Switch>
      </Suspense>
    );
  }

  return (
    <Switch>
      <Route path="/SteepIn">
        <Suspense fallback={<SteepInFallback />}>
          <SteepInPage />
        </Suspense>
      </Route>
      <Route path="/login">
        <Suspense fallback={<PageFallback />}>
          {isAuthenticated ? <Redirect to="/" /> : <LoginPage />}
        </Suspense>
      </Route>
      <Route>
        {isAuthenticated ? <AuthenticatedLayout /> : <Redirect to="/login" />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ErrorBoundary>
            <AuthProvider>
              <AppContent />
            </AuthProvider>
          </ErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
