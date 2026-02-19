import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { LogIn, KeyRound, Monitor, UserPlus } from "lucide-react";
import { useLocation } from "wouter";
import logoImage from "@assets/m3MJU_1771476103365.png";

const LEAF_YELLOW = "#D4C5A0";
const LEAF_GREEN = "#8B9E8B";

export default function LoginPage() {
  const { isAuthenticated, login, loginSteepIn, loginWithCode, registerManager, registerAccount } = useAuth();
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
  const [steepinForm, setSteepinForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", password: "", agencyName: "" });
  const [signupForm, setSignupForm] = useState({ username: "", password: "", confirmPassword: "", email: "" });
  const [loading, setLoading] = useState(false);
  const [showSignup, setShowSignup] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(loginForm.username, loginForm.password);
      toast({ title: "Welcome back", description: "You have been logged in." });
      setLocation("/");
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

  const handleSteepInLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginSteepIn(steepinForm.username, steepinForm.password);
      toast({ title: "SteepIn Active", description: "Kiosk mode is now active." });
      setLocation("/SteepIn");
    } catch (err: any) {
      toast({ title: "SteepIn login failed", description: err.message, variant: "destructive" });
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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signupForm.password !== signupForm.confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await registerAccount(signupForm.username, signupForm.password, signupForm.confirmPassword, signupForm.email);
      toast({ title: "Account created", description: "Your account is ready." });
      setLocation("/");
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (setupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW }}>
        <Skeleton className="w-[420px] h-[500px] rounded-md" />
      </div>
    );
  }

  const showSetup = setupData?.setupRequired;

  const inputStyle = "bg-white/90 border-[#b8cbb8] text-[#3a4a3a] placeholder:text-[#8B9E8B]/70 focus-visible:ring-[#8B9E8B]";
  const labelStyle = { color: LEAF_YELLOW };

  if (showSignup) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW }}>
        <div className="w-full max-w-[420px] space-y-6">
          <div className="text-center space-y-2">
            <img
              src={logoImage}
              alt="LeafLog"
              className="w-20 h-20 mx-auto rounded-xl object-cover"
              data-testid="img-logo"
            />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_YELLOW }} data-testid="text-signup-title">
              Create Account
            </h1>
            <p className="text-sm" style={{ color: "#8a7d60" }}>Register a new LeafLog account</p>
          </div>

          <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
            <form onSubmit={handleSignup} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="signup-username" style={labelStyle}>Username</Label>
                <Input
                  id="signup-username"
                  placeholder="Choose a unique username"
                  value={signupForm.username}
                  onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })}
                  required
                  minLength={3}
                  className={inputStyle}
                  data-testid="input-signup-username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-email" style={labelStyle}>Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="your@email.com"
                  value={signupForm.email}
                  onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                  required
                  className={inputStyle}
                  data-testid="input-signup-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-password" style={labelStyle}>Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={signupForm.password}
                  onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                  required
                  minLength={6}
                  className={inputStyle}
                  data-testid="input-signup-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-confirm" style={labelStyle}>Confirm Password</Label>
                <Input
                  id="signup-confirm"
                  type="password"
                  placeholder="Re-enter your password"
                  value={signupForm.confirmPassword}
                  onChange={(e) => setSignupForm({ ...signupForm, confirmPassword: e.target.value })}
                  required
                  minLength={6}
                  className={inputStyle}
                  data-testid="input-signup-confirm"
                />
              </div>
              <Button
                type="submit"
                className="w-full font-semibold"
                style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                disabled={loading}
                data-testid="button-signup"
              >
                {loading ? "Creating account..." : "Create Account"}
              </Button>
            </form>
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <button
                onClick={() => setShowSignup(false)}
                className="text-sm underline underline-offset-2 cursor-pointer"
                style={{ color: LEAF_YELLOW }}
                data-testid="button-back-to-login"
              >
                Already have an account? Sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW }}>
      <div className="w-full max-w-[420px] space-y-6">
        <div className="text-center space-y-2">
          <img
            src={logoImage}
            alt="LeafLog"
            className="w-24 h-24 mx-auto rounded-xl object-cover"
            data-testid="img-logo"
          />
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_GREEN }} data-testid="text-login-title">
            LeafLog
          </h1>
          <p className="text-sm" style={{ color: "#8a7d60" }}>Tea & Shift Management</p>
        </div>

        {showSetup ? (
          <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="w-5 h-5" style={{ color: LEAF_YELLOW }} />
              <h2 className="text-base font-semibold" style={{ color: LEAF_YELLOW }} data-testid="text-setup-title">Set Up Manager Account</h2>
            </div>
            <p className="text-sm mb-4" style={{ color: "#d4d4c0" }}>
              Welcome! Create your manager account to get started with LeafLog.
            </p>
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="agency" style={labelStyle}>Agency / Business Name</Label>
                <Input
                  id="agency"
                  placeholder="e.g. Sunrise Cafe"
                  value={registerForm.agencyName}
                  onChange={(e) => setRegisterForm({ ...registerForm, agencyName: e.target.value })}
                  required
                  className={inputStyle}
                  data-testid="input-register-agency"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-username" style={labelStyle}>Username</Label>
                <Input
                  id="reg-username"
                  placeholder="Choose a username"
                  value={registerForm.username}
                  onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                  required
                  minLength={3}
                  className={inputStyle}
                  data-testid="input-register-username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-password" style={labelStyle}>Password</Label>
                <Input
                  id="reg-password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                  required
                  minLength={6}
                  className={inputStyle}
                  data-testid="input-register-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full font-semibold"
                style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                disabled={loading}
                data-testid="button-register"
              >
                {loading ? "Creating account..." : "Create Manager Account"}
              </Button>
            </form>
          </div>
        ) : (
          <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full grid grid-cols-3 mb-4 bg-[#7a8e7a]">
                <TabsTrigger
                  value="login"
                  className="text-xs data-[state=active]:bg-[#D4C5A0] data-[state=active]:text-[#3a4a3a] text-[#D4C5A0]/80"
                  data-testid="tab-login"
                >
                  <LogIn className="w-3.5 h-3.5 mr-1" /> Head Gardener
                </TabsTrigger>
                <TabsTrigger
                  value="code"
                  className="text-xs data-[state=active]:bg-[#D4C5A0] data-[state=active]:text-[#3a4a3a] text-[#D4C5A0]/80"
                  data-testid="tab-code"
                >
                  <KeyRound className="w-3.5 h-3.5 mr-1" /> Leaf Login
                </TabsTrigger>
                <TabsTrigger
                  value="kiosk"
                  className="text-xs data-[state=active]:bg-[#D4C5A0] data-[state=active]:text-[#3a4a3a] text-[#D4C5A0]/80"
                  data-testid="tab-kiosk"
                >
                  <Monitor className="w-3.5 h-3.5 mr-1" /> SteepIn
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <p className="text-sm" style={{ color: "#d4d4c0" }}>Sign in with your admin or manager credentials.</p>
                <form onSubmit={handleLogin} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="username" style={labelStyle}>Username</Label>
                    <Input
                      id="username"
                      placeholder="Enter username"
                      value={loginForm.username}
                      onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                      required
                      className={inputStyle}
                      data-testid="input-login-username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" style={labelStyle}>Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter password"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      required
                      className={inputStyle}
                      data-testid="input-login-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full font-semibold"
                    style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                    disabled={loading}
                    data-testid="button-login"
                  >
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="code" className="space-y-4">
                <p className="text-sm" style={{ color: "#d4d4c0" }}>
                  Enter the access code provided by your manager to sign in as an employee.
                </p>
                <form onSubmit={handleCodeLogin} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="access-code" style={labelStyle}>Access Code</Label>
                    <Input
                      id="access-code"
                      placeholder="e.g. agencyname-employeename-abc123..."
                      value={codeForm.code}
                      onChange={(e) => setCodeForm({ code: e.target.value })}
                      required
                      className={`font-mono text-sm ${inputStyle}`}
                      data-testid="input-access-code"
                    />
                  </div>
                  <p className="text-xs" style={{ color: "#c8c8b4" }}>
                    Access codes are valid for 48 hours. Ask your manager for a new code if yours has expired.
                  </p>
                  <Button
                    type="submit"
                    className="w-full font-semibold"
                    style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                    disabled={loading}
                    data-testid="button-code-login"
                  >
                    {loading ? "Verifying..." : "Enter with Code"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="kiosk" className="space-y-4">
                <p className="text-sm" style={{ color: "#d4d4c0" }}>
                  Sign in with manager or admin credentials to launch the SteepIn kiosk for employee time tracking.
                </p>
                <form onSubmit={handleSteepInLogin} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="steepin-username" style={labelStyle}>Username</Label>
                    <Input
                      id="steepin-username"
                      placeholder="Manager or admin username"
                      value={steepinForm.username}
                      onChange={(e) => setSteepinForm({ ...steepinForm, username: e.target.value })}
                      required
                      className={inputStyle}
                      data-testid="input-steepin-username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="steepin-password" style={labelStyle}>Password</Label>
                    <Input
                      id="steepin-password"
                      type="password"
                      placeholder="Enter password"
                      value={steepinForm.password}
                      onChange={(e) => setSteepinForm({ ...steepinForm, password: e.target.value })}
                      required
                      className={inputStyle}
                      data-testid="input-steepin-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full font-semibold"
                    style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                    disabled={loading}
                    data-testid="button-steepin-login"
                  >
                    {loading ? "Launching..." : "Launch SteepIn"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <button
                onClick={() => setShowSignup(true)}
                className="text-sm underline underline-offset-2 cursor-pointer"
                style={{ color: LEAF_YELLOW }}
                data-testid="button-go-to-signup"
              >
                Don't have an account? Register
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
