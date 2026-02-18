import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, LogIn, KeyRound, Monitor, Building2, UserPlus } from "lucide-react";
import { useLocation } from "wouter";

export default function LoginPage() {
  const { isAuthenticated, login, loginWithCode, registerManager } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  if (isAuthenticated) {
    setLocation("/");
    return null;
  }

  const { data: setupData, isLoading: setupLoading } = useQuery<{ setupRequired: boolean }>({
    queryKey: ["/api/auth/setup-required"],
  });

  const [tab, setTab] = useState<string>("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [codeForm, setCodeForm] = useState({ code: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", password: "", agencyName: "" });
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(loginForm.username, loginForm.password);
      toast({ title: "Welcome back", description: "You have been logged in." });
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginWithCode(codeForm.code);
      toast({ title: "Welcome", description: "You have been logged in with your access code." });
    } catch (err: any) {
      toast({ title: "Access code error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registerForm.password.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await registerManager(registerForm.username, registerForm.password, registerForm.agencyName);
      toast({ title: "Account created", description: "Your manager account is ready." });
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleKiosk = () => {
    setLocation("/kiosk");
  };

  if (setupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Skeleton className="w-[420px] h-[500px] rounded-md" />
      </div>
    );
  }

  const showSetup = setupData?.setupRequired;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center mx-auto w-12 h-12 rounded-md bg-primary mb-3">
            <Clock className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-login-title">LeafLog</h1>
          <p className="text-sm text-muted-foreground">Tea & Shift Management</p>
        </div>

        {showSetup ? (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold" data-testid="text-setup-title">Set Up Manager Account</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Welcome! Create your manager account to get started with LeafLog.
            </p>
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="agency">Agency / Business Name</Label>
                <Input
                  id="agency"
                  placeholder="e.g. Sunrise Cafe"
                  value={registerForm.agencyName}
                  onChange={(e) => setRegisterForm({ ...registerForm, agencyName: e.target.value })}
                  required
                  data-testid="input-register-agency"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-username">Username</Label>
                <Input
                  id="reg-username"
                  placeholder="Choose a username"
                  value={registerForm.username}
                  onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                  required
                  minLength={3}
                  data-testid="input-register-username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                  required
                  minLength={6}
                  data-testid="input-register-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-register">
                {loading ? "Creating account..." : "Create Manager Account"}
              </Button>
            </form>
            <div className="mt-4 pt-4 border-t">
              <Button variant="outline" className="w-full" onClick={handleKiosk} data-testid="button-kiosk-from-setup">
                <Monitor className="w-4 h-4 mr-2" /> Use as Kiosk
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="p-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full grid grid-cols-3 mb-4">
                <TabsTrigger value="login" data-testid="tab-login">
                  <LogIn className="w-3.5 h-3.5 mr-1.5" /> Sign In
                </TabsTrigger>
                <TabsTrigger value="code" data-testid="tab-code">
                  <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Code
                </TabsTrigger>
                <TabsTrigger value="kiosk" data-testid="tab-kiosk">
                  <Monitor className="w-3.5 h-3.5 mr-1.5" /> SteepIn
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <p className="text-sm text-muted-foreground">Sign in with your admin or manager credentials.</p>
                <form onSubmit={handleLogin} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      placeholder="Enter username"
                      value={loginForm.username}
                      onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                      required
                      data-testid="input-login-username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter password"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      required
                      data-testid="input-login-password"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading} data-testid="button-login">
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="code" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter the access code provided by your manager to sign in as an employee.
                </p>
                <form onSubmit={handleCodeLogin} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="access-code">Access Code</Label>
                    <Input
                      id="access-code"
                      placeholder="e.g. agencyname-employeename-abc123..."
                      value={codeForm.code}
                      onChange={(e) => setCodeForm({ code: e.target.value })}
                      required
                      className="font-mono text-sm"
                      data-testid="input-access-code"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Access codes are valid for 48 hours. Ask your manager for a new code if yours has expired.
                  </p>
                  <Button type="submit" className="w-full" disabled={loading} data-testid="button-code-login">
                    {loading ? "Verifying..." : "Enter with Code"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="kiosk" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Launch SteepIn for employee clock-in, clock-out, and break tracking.
                </p>
                <div className="bg-muted/50 rounded-md p-4 text-center space-y-2">
                  <Monitor className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-xs text-muted-foreground">
                    SteepIn allows employees to punch in/out without logging into their account.
                  </p>
                </div>
                <Button onClick={handleKiosk} className="w-full" data-testid="button-launch-kiosk">
                  <Monitor className="w-4 h-4 mr-2" /> Launch SteepIn
                </Button>
              </TabsContent>
            </Tabs>
          </Card>
        )}
      </div>
    </div>
  );
}
