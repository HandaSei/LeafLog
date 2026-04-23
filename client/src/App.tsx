import { Switch, Route, Redirect } from "wouter";
import { lazy, Suspense } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import LoginPage from "@/pages/login";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Schedule = lazy(() => import("@/pages/schedule"));
const Employees = lazy(() => import("@/pages/employees"));
const Timesheets = lazy(() => import("@/pages/timesheets"));
const Settings = lazy(() => import("@/pages/settings"));
const AdminPage = lazy(() => import("@/pages/admin"));
const NotFound = lazy(() => import("@/pages/not-found"));
const SteepInPage = lazy(() => import("@/pages/steepin"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <Skeleton className="w-full max-w-2xl h-[400px] rounded-md" />
    </div>
  );
}

function SteepInFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F5F5F0" }}>
      <div
        className="w-10 h-10 border-[3px] rounded-full animate-spin"
        style={{ borderColor: "rgba(139, 158, 139, 0.2)", borderTopColor: "#8B9E8B" }}
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
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
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

  // Show loading spinner only during initial auth verification
  // This happens when there's no cached auth and we're checking with the server
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F5F5F0" }}>
        <div
          className="w-10 h-10 border-[3px] rounded-full animate-spin"
          style={{ borderColor: "rgba(139, 158, 139, 0.2)", borderTopColor: "#8B9E8B" }}
        />
      </div>
    );
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
        {isAuthenticated ? <Redirect to="/" /> : <LoginPage />}
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
          <AuthProvider>
            <AppContent />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
