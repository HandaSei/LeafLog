import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { LogIn, KeyRound, Monitor, UserPlus, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import logoImage from "@assets/m3MJU_1771476103365.png";

const LEAF_YELLOW = "#D4C5A0";
const LEAF_YELLOW_BG = "#E8DCC4";
const LEAF_GREEN = "#8B9E8B";

type View = "main" | "signup" | "verify-registration" | "forgot-password" | "reset-password" | "upgrade-employee" | "verify-upgrade";

export default function LoginPage() {
  const {
    isAuthenticated, isShadowAccount, login, loginSteepIn, loginWithCode,
    registerManager, verifyEmail, forgotPassword, resetPassword,
    upgradeEmployee, verifyEmployeeUpgrade, logout,
  } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: setupData, isLoading: setupLoading } = useQuery<{ setupRequired: boolean }>({
    queryKey: ["/api/auth/setup-required"],
  });

  const [view, setView] = useState<View>("main");
  const [tab, setTab] = useState<string>("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [codeForm, setCodeForm] = useState({ code: "" });
  const [steepinForm, setSteepinForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", password: "", email: "", agencyName: "" });
  const [signupForm, setSignupForm] = useState({ username: "", password: "", email: "", agencyName: "" });
  const [forgotForm, setForgotForm] = useState({ email: "" });
  const [emailSent, setEmailSent] = useState(true);
  const [resetForm, setResetForm] = useState({ email: "", code: "", newPassword: "" });
  const [verifyCode, setVerifyCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [upgradeForm, setUpgradeForm] = useState({ username: "", password: "", email: "" });
  const [upgradeEmail, setUpgradeEmail] = useState("");
  const [upgradeCode, setUpgradeCode] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated && isShadowAccount) {
    if (view !== "upgrade-employee" && view !== "verify-upgrade") {
      return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
          <div className="w-full max-w-[420px] space-y-6">
            <div className="text-center space-y-2">
              <img src={logoImage} alt="LeafLog" className="w-28 h-28 mx-auto rounded-xl object-cover" data-testid="img-logo" />
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_GREEN }} data-testid="text-upgrade-title">
                Create Your Account
              </h1>
              <p className="text-sm" style={{ color: "#8a7d60" }}>Set up a permanent account to access LeafLog anytime</p>
            </div>
            <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
              <form onSubmit={handleUpgradeEmployee} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="upgrade-username" style={labelStyle}>Username</Label>
                  <Input
                    id="upgrade-username"
                    placeholder="Choose a username"
                    value={upgradeForm.username}
                    onChange={(e) => setUpgradeForm({ ...upgradeForm, username: e.target.value })}
                    required
                    minLength={3}
                    className={inputStyle}
                    data-testid="input-upgrade-username"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="upgrade-email" style={labelStyle}>Email</Label>
                  <Input
                    id="upgrade-email"
                    type="email"
                    placeholder="your@email.com"
                    value={upgradeForm.email}
                    onChange={(e) => setUpgradeForm({ ...upgradeForm, email: e.target.value })}
                    required
                    className={inputStyle}
                    data-testid="input-upgrade-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="upgrade-password" style={labelStyle}>Password</Label>
                  <Input
                    id="upgrade-password"
                    type="password"
                    placeholder="Min 6 characters"
                    value={upgradeForm.password}
                    onChange={(e) => setUpgradeForm({ ...upgradeForm, password: e.target.value })}
                    required
                    minLength={6}
                    className={inputStyle}
                    data-testid="input-upgrade-password"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full font-semibold"
                  style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                  disabled={loading}
                  data-testid="button-upgrade-submit"
                >
                  {loading ? "Sending verification..." : "Create Account"}
                </Button>
              </form>
              <div className="mt-4 pt-4 border-t border-white/20 text-center">
                <button
                  onClick={() => { setLocation("/"); }}
                  className="text-sm underline underline-offset-2 cursor-pointer"
                  style={{ color: LEAF_YELLOW }}
                  data-testid="button-skip-upgrade"
                >
                  Skip for now
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (view === "verify-upgrade") {
      return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
          <div className="w-full max-w-[420px] space-y-6">
            <div className="text-center space-y-2">
              <img src={logoImage} alt="LeafLog" className="w-28 h-28 mx-auto rounded-xl object-cover" data-testid="img-logo" />
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_GREEN }} data-testid="text-verify-upgrade-title">
                Verify Your Email
              </h1>
              <p className="text-sm" style={{ color: "#8a7d60" }}>
                We sent a 6-digit code to <strong>{upgradeEmail}</strong>
              </p>
            </div>
            <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
              <form onSubmit={handleVerifyUpgrade} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="verify-upgrade-code" style={labelStyle}>Verification Code</Label>
                  <Input
                    id="verify-upgrade-code"
                    placeholder="000000"
                    value={upgradeCode}
                    onChange={(e) => setUpgradeCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    maxLength={6}
                    className={`font-mono text-center text-lg tracking-[0.3em] ${inputStyle}`}
                    data-testid="input-verify-upgrade-code"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full font-semibold"
                  style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                  disabled={loading || upgradeCode.length !== 6}
                  data-testid="button-verify-upgrade"
                >
                  {loading ? "Verifying..." : "Verify & Create Account"}
                </Button>
              </form>
              <div className="mt-4 pt-4 border-t border-white/20 text-center">
                <button
                  onClick={() => setView("upgrade-employee")}
                  className="text-sm underline underline-offset-2 cursor-pointer"
                  style={{ color: LEAF_YELLOW }}
                  data-testid="button-back-upgrade"
                >
                  <ArrowLeft className="w-3 h-3 inline mr-1" />
                  Back
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  if (isAuthenticated && !isShadowAccount) {
    setLocation("/");
    return null;
  }

  async function handleLogin(e: React.FormEvent) {
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
  }

  async function handleCodeLogin(e: React.FormEvent) {
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
  }

  async function handleSteepInLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await loginSteepIn(steepinForm.username, steepinForm.password);
      toast({ title: "SteepIn Active", description: "SteepIn mode is now active." });
      setLocation("/SteepIn");
    } catch (err: any) {
      toast({ title: "SteepIn login failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (registerForm.password.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await registerManager(registerForm.username, registerForm.password, registerForm.email, registerForm.agencyName);
      if (result.requiresVerification) {
        setPendingEmail(result.email);
        setEmailSent(result.emailSent !== false);
        setView("verify-registration");
        if (result.emailSent !== false) {
          toast({ title: "Check your email", description: "We sent a verification code to your email." });
        }
      }
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (signupForm.password.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await registerManager(signupForm.username, signupForm.password, signupForm.email, signupForm.agencyName);
      if (result.requiresVerification) {
        setPendingEmail(result.email);
        setEmailSent(result.emailSent !== false);
        setView("verify-registration");
        if (result.emailSent !== false) {
          toast({ title: "Check your email", description: "We sent a verification code to your email." });
        }
      }
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyRegistration(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await verifyEmail(pendingEmail, verifyCode);
      toast({ title: "Account created", description: "Your email has been verified and your account is ready." });
      setLocation("/");
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await forgotPassword(forgotForm.email);
      setResetForm({ ...resetForm, email: forgotForm.email });
      setEmailSent(result?.emailSent !== false);
      setView("reset-password");
      if (result?.emailSent !== false) {
        toast({ title: "Check your email", description: "If an account exists with that email, we sent a reset code." });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (resetForm.newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await resetPassword(resetForm.email, resetForm.code, resetForm.newPassword);
      toast({ title: "Password reset", description: "Your password has been updated. You can now sign in." });
      setView("main");
      setTab("login");
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleUpgradeEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (upgradeForm.password.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await upgradeEmployee(upgradeForm.username, upgradeForm.password, upgradeForm.email);
      if (result.requiresVerification) {
        setUpgradeEmail(result.email);
        setView("verify-upgrade");
        toast({ title: "Check your email", description: "We sent a verification code to your email." });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyUpgrade(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await verifyEmployeeUpgrade(upgradeEmail, upgradeCode);
      toast({ title: "Account created", description: "Your permanent account is ready." });
      setLocation("/");
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = "bg-white/90 border-[#b8cbb8] text-[#3a4a3a] placeholder:text-[#8B9E8B]/70 focus-visible:ring-[#8B9E8B]";
  const labelStyle = { color: LEAF_YELLOW };

  if (setupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
        <Skeleton className="w-[420px] h-[500px] rounded-md" />
      </div>
    );
  }

  const showSetup = setupData?.setupRequired;

  if (view === "verify-registration") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
        <div className="w-full max-w-[420px] space-y-6">
          <div className="text-center space-y-2">
            <img src={logoImage} alt="LeafLog" className="w-28 h-28 mx-auto rounded-xl object-cover" data-testid="img-logo" />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_GREEN }} data-testid="text-verify-title">
              Verify Your Email
            </h1>
            {emailSent ? (
              <p className="text-sm" style={{ color: "#8a7d60" }}>
                We sent a 6-digit code to <strong>{pendingEmail}</strong>
              </p>
            ) : (
              <p className="text-sm" style={{ color: "#a06050" }}>
                Email could not be sent — contact the app administrator for your verification code.
              </p>
            )}
          </div>
          <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
            <form onSubmit={handleVerifyRegistration} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="verify-code" style={labelStyle}>Verification Code</Label>
                <Input
                  id="verify-code"
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  maxLength={6}
                  className={`font-mono text-center text-lg tracking-[0.3em] ${inputStyle}`}
                  data-testid="input-verify-code"
                />
              </div>
              <p className="text-xs" style={{ color: "#c8c8b4" }}>
                {emailSent ? "The code expires in 15 minutes. Check your spam folder if you don't see it." : "The code was logged by the server administrator."}
              </p>
              <Button
                type="submit"
                className="w-full font-semibold"
                style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                disabled={loading || verifyCode.length !== 6}
                data-testid="button-verify"
              >
                {loading ? "Verifying..." : "Verify Email"}
              </Button>
            </form>
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <button
                onClick={() => { setView(showSetup ? "main" : "signup"); setVerifyCode(""); }}
                className="text-sm underline underline-offset-2 cursor-pointer"
                style={{ color: LEAF_YELLOW }}
                data-testid="button-back-verify"
              >
                <ArrowLeft className="w-3 h-3 inline mr-1" />
                Back to registration
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "forgot-password") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
        <div className="w-full max-w-[420px] space-y-6">
          <div className="text-center space-y-2">
            <img src={logoImage} alt="LeafLog" className="w-28 h-28 mx-auto rounded-xl object-cover" data-testid="img-logo" />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_GREEN }} data-testid="text-forgot-title">
              Forgot Password
            </h1>
            <p className="text-sm" style={{ color: "#8a7d60" }}>
              Enter the email address linked to your account
            </p>
          </div>
          <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email" style={labelStyle}>Email Address</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="your@email.com"
                  value={forgotForm.email}
                  onChange={(e) => setForgotForm({ email: e.target.value })}
                  required
                  className={inputStyle}
                  data-testid="input-forgot-email"
                />
              </div>
              <Button
                type="submit"
                className="w-full font-semibold"
                style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                disabled={loading}
                data-testid="button-forgot-submit"
              >
                {loading ? "Sending..." : "Send Reset Code"}
              </Button>
            </form>
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <button
                onClick={() => setView("main")}
                className="text-sm underline underline-offset-2 cursor-pointer"
                style={{ color: LEAF_YELLOW }}
                data-testid="button-back-forgot"
              >
                <ArrowLeft className="w-3 h-3 inline mr-1" />
                Back to sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "reset-password") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
        <div className="w-full max-w-[420px] space-y-6">
          <div className="text-center space-y-2">
            <img src={logoImage} alt="LeafLog" className="w-28 h-28 mx-auto rounded-xl object-cover" data-testid="img-logo" />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_GREEN }} data-testid="text-reset-title">
              Reset Password
            </h1>
            {emailSent ? (
              <p className="text-sm" style={{ color: "#8a7d60" }}>
                Enter the code sent to <strong>{resetForm.email}</strong>
              </p>
            ) : (
              <p className="text-sm" style={{ color: "#a06050" }}>
                Email could not be sent — ask the app administrator for your reset code.
              </p>
            )}
          </div>
          <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reset-code" style={labelStyle}>Verification Code</Label>
                <Input
                  id="reset-code"
                  placeholder="000000"
                  value={resetForm.code}
                  onChange={(e) => setResetForm({ ...resetForm, code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                  required
                  maxLength={6}
                  className={`font-mono text-center text-lg tracking-[0.3em] ${inputStyle}`}
                  data-testid="input-reset-code"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-new-password" style={labelStyle}>New Password</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={resetForm.newPassword}
                  onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                  required
                  minLength={6}
                  className={inputStyle}
                  data-testid="input-reset-new-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full font-semibold"
                style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                disabled={loading || resetForm.code.length !== 6}
                data-testid="button-reset-submit"
              >
                {loading ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <button
                onClick={() => setView("forgot-password")}
                className="text-sm underline underline-offset-2 cursor-pointer"
                style={{ color: LEAF_YELLOW }}
                data-testid="button-back-reset"
              >
                <ArrowLeft className="w-3 h-3 inline mr-1" />
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "signup") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
        <div className="w-full max-w-[420px] space-y-6">
          <div className="text-center space-y-2">
            <img src={logoImage} alt="LeafLog" className="w-28 h-28 mx-auto rounded-xl object-cover" data-testid="img-logo" />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: LEAF_GREEN }} data-testid="text-signup-title">
              Create Account
            </h1>
            <p className="text-sm" style={{ color: "#8a7d60" }}>Register a new LeafLog account</p>
          </div>
          <div className="rounded-xl p-6" style={{ backgroundColor: LEAF_GREEN }}>
            <form onSubmit={handleSignup} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="signup-agency" style={labelStyle}>Agency / Business Name</Label>
                <Input
                  id="signup-agency"
                  placeholder="e.g. Sunrise Cafe"
                  value={signupForm.agencyName}
                  onChange={(e) => setSignupForm({ ...signupForm, agencyName: e.target.value })}
                  required
                  className={inputStyle}
                  data-testid="input-signup-agency"
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
              <Button
                type="submit"
                className="w-full font-semibold"
                style={{ backgroundColor: LEAF_YELLOW, color: "#3a4a3a" }}
                disabled={loading}
                data-testid="button-signup"
              >
                {loading ? "Sending verification..." : "Create Manager Account"}
              </Button>
            </form>
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <button
                onClick={() => setView("main")}
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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: LEAF_YELLOW_BG }}>
      <div className="w-full max-w-[420px] space-y-6">
        <div className="text-center space-y-2">
          <img src={logoImage} alt="LeafLog" className="w-28 h-28 mx-auto rounded-xl object-cover" data-testid="img-logo" />
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
                <Label htmlFor="reg-email" style={labelStyle}>Email</Label>
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="your@email.com"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                  required
                  className={inputStyle}
                  data-testid="input-register-email"
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
                {loading ? "Sending verification..." : "Create Manager Account"}
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
                  value="steepin"
                  className="text-xs data-[state=active]:bg-[#D4C5A0] data-[state=active]:text-[#3a4a3a] text-[#D4C5A0]/80"
                  data-testid="tab-steepin"
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
                <div className="text-center">
                  <button
                    onClick={() => setView("forgot-password")}
                    className="text-xs underline underline-offset-2 cursor-pointer"
                    style={{ color: "#c8c8b4" }}
                    data-testid="button-forgot-password"
                  >
                    Forgot your password?
                  </button>
                </div>
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

              <TabsContent value="steepin" className="space-y-4">
                <p className="text-sm" style={{ color: "#d4d4c0" }}>
                  Sign in with manager or admin credentials to launch the SteepIn mode for employee time tracking.
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
                onClick={() => setView("signup")}
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
