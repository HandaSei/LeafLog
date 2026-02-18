import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Schedule from "@/pages/schedule";
import Employees from "@/pages/employees";
import LoginPage from "@/pages/login";
import KioskPage from "@/pages/kiosk";

function AuthenticatedRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/employees" component={Employees} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-hidden">
            <AuthenticatedRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Skeleton className="w-[300px] h-[400px] rounded-md" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/kiosk" component={KioskPage} />
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
