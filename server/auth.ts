import { Router, Request, Response, NextFunction } from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { storage } from "./storage";
import { loginSchema, registerManagerSchema, accessCodeLoginSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, upgradeEmployeeSchema, type Account } from "@shared/schema";
import { format } from "date-fns";
import { sendVerificationEmail, generateCode } from "./email";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
    employeeId: number | null;
    steepinMode: boolean;
  }
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = "connect.sid";
const LONG_LIVED_SESSION_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years
const STANDARD_SESSION_MAX_AGE_MS = LONG_LIVED_SESSION_MAX_AGE_MS;
const STEEPIN_SESSION_MAX_AGE_MS = LONG_LIVED_SESSION_MAX_AGE_MS;

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? "none" as const : "lax" as const,
  };
}

function setSessionLifetime(req: Request, maxAge: number) {
  req.session.cookie.maxAge = maxAge;
  req.session.cookie.httpOnly = true;
  req.session.cookie.secure = IS_PRODUCTION;
  req.session.cookie.sameSite = IS_PRODUCTION ? "none" : "lax";
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function startAccountSession(req: Request, account: Account, options?: { steepinMode?: boolean }) {
  const steepinMode = options?.steepinMode ?? false;
  await regenerateSession(req);
  req.session.userId = account.id;
  req.session.role = account.role;
  req.session.employeeId = account.employeeId ?? null;
  req.session.steepinMode = steepinMode;
  setSessionLifetime(req, steepinMode ? STEEPIN_SESSION_MAX_AGE_MS : STANDARD_SESSION_MAX_AGE_MS);
  await saveSession(req);
}

export function setupSession(app: any) {
  const PgStore = pgSession(session);

  app.use(
    session({
      store: new PgStore({
        conString: (() => {
          const isProd = process.env.NODE_ENV === "production";
          let connStr = isProd
            ? (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL)
            : (process.env.DEV_DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);
          if (connStr) {
            const u = new URL(connStr);
            u.searchParams.delete("channel_binding");
            // Use direct (non-pooler) connection for session store — Neon's PgBouncer
            // transaction mode is incompatible with connect-pg-simple
            u.hostname = u.hostname.replace("-pooler.", ".");
            connStr = u.toString();
          }
          return connStr;
        })(),
        createTableIfMissing: true,
      }),
      secret: (() => {
        const secret = process.env.SESSION_SECRET;
        if (secret) return secret;
        if (process.env.NODE_ENV === "production") {
          throw new Error("SESSION_SECRET environment variable is required in production");
        }
        console.warn("[Auth] SESSION_SECRET not set. Using a random dev secret (sessions will reset on restart).");
        return crypto.randomBytes(32).toString("hex");
      })(),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        maxAge: STANDARD_SESSION_MAX_AGE_MS,
        ...getSessionCookieOptions(),
      },
    })
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const account = await storage.getAccount(req.session.userId);
    if (!account) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    req.session.role = account.role;
    req.session.employeeId = account.employeeId ?? null;

    if (!roles.includes(account.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const CAN_EXPOSE_EMAIL_FALLBACK_CODE = process.env.NODE_ENV !== "production";
const EMAIL_DELIVERY_FAILED_MESSAGE = "Verification email could not be sent. Please try again later.";

interface RateLimitRecord {
  count: number;
  windowStart: number;
  blockedUntil?: number;
}

interface LimiterConfig {
  max: number;
  blockMs: number;
  prefix: string;
  blockMessage: string;
}

const rateLimitStore = new Map<string, RateLimitRecord>();
const MAX_STORE_ENTRIES = 10000; // memory-bound cap to mitigate DoS by unique-IP flooding

setInterval(() => {
  const now = Date.now();
  rateLimitStore.forEach((record, key) => {
    const windowExpired = now - record.windowStart > WINDOW_MS;
    const blockExpired = !record.blockedUntil || now > record.blockedUntil;
    if (windowExpired && blockExpired) rateLimitStore.delete(key);
  });
}, 60 * 60 * 1000);

function checkRateLimit(key: string, cfg: LimiterConfig): { allowed: boolean; message?: string } {
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (record) {
    if (record.blockedUntil && now < record.blockedUntil) {
      const minutesLeft = Math.ceil((record.blockedUntil - now) / 60000);
      return { allowed: false, message: `Too many attempts. Try again in ${minutesLeft} minutes.` };
    }
    if (now - record.windowStart > WINDOW_MS) {
      rateLimitStore.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }
    record.count++;
    if (record.count > cfg.max) {
      record.blockedUntil = now + cfg.blockMs;
      return { allowed: false, message: cfg.blockMessage };
    }
    return { allowed: true };
  }
  // Soft cap to prevent unbounded growth under attack; cleanup interval reclaims.
  if (rateLimitStore.size >= MAX_STORE_ENTRIES) return { allowed: true };
  rateLimitStore.set(key, { count: 1, windowStart: now });
  return { allowed: true };
}

function makeLimiter(cfg: LimiterConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || (req.connection?.remoteAddress as string) || "unknown";
    const key = `${cfg.prefix}:${ip}`;
    const result = checkRateLimit(key, cfg);
    if (!result.allowed) return res.status(429).json({ message: result.message });
    next();
  };
}

function getEmailFallbackFields(sent: boolean, code: string): { emailSent: boolean; fallbackCode?: string } {
  if (sent) return { emailSent: true };
  if (CAN_EXPOSE_EMAIL_FALLBACK_CODE) return { emailSent: false, fallbackCode: code };
  return { emailSent: false };
}

function logEmailSendFailure(label: string, email: string, code: string) {
  if (CAN_EXPOSE_EMAIL_FALLBACK_CODE) {
    console.log(`[EMAIL FALLBACK] ${label} code for ${email}: ${code}`);
    return;
  }
  console.warn(`[Email] Failed to send ${label} verification email to ${email}`);
}

// Aggressive limiter for credential / sensitive endpoints (low legitimate frequency).
export const authRateLimiter = makeLimiter({
  prefix: "cred",
  max: 20,
  blockMs: 60 * 60 * 1000,
  blockMessage: "Too many attempts. You are blocked for 1 hour.",
});

// Relaxed limiter for kiosk operational endpoints; busy shops with many employees
// share one public IP, so the credential-tier limit would lock out the whole site.
// Still bounds brute-force at ~13/min per IP, after which the device cools down.
export const kioskRateLimiter = makeLimiter({
  prefix: "kiosk",
  max: 200,
  blockMs: 30 * 60 * 1000,
  blockMessage: "Too many attempts from this device. Try again in 30 minutes.",
});

function generateAccessCode(agencyName: string, employeeName: string): string {
  const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const randomPart = crypto.randomBytes(8).toString("hex");
  return `${sanitize(agencyName)}-${sanitize(employeeName)}-${randomPart}`;
}

export function registerAuthRoutes(router: Router) {
  router.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.json({ authenticated: false });
    }
    const account = await storage.getAccount(req.session.userId);
    if (!account) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false });
    }
    const { password, ...safe } = account;
    let employee = null;
    if (account.employeeId) {
      employee = await storage.getEmployee(account.employeeId);
    }
    res.json({ authenticated: true, user: safe, employee, steepinMode: !!req.session.steepinMode });
  });

  router.get("/api/auth/setup-required", async (_req, res) => {
    const hasManagers = await storage.hasAnyManagers();
    res.json({ setupRequired: !hasManagers });
  });

  router.post("/api/auth/register-manager", authRateLimiter, async (req, res) => {
    const parsed = registerManagerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const existing = await storage.getAccountByUsername(parsed.data.username);
    if (existing) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const existingEmail = await storage.getAccountByEmail(parsed.data.email);
    if (existingEmail) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
    const code = generateCode();

    await storage.invalidatePendingVerifications(parsed.data.email, "registration");
    await storage.createEmailVerification(parsed.data.email, code, "registration", {
      username: parsed.data.username,
      password: hashedPassword,
      agencyName: parsed.data.agencyName,
      email: parsed.data.email,
      country: parsed.data.country || null,
    });

    const sent = await sendVerificationEmail(parsed.data.email, code, "registration");
    if (!sent) {
      logEmailSendFailure("Registration", parsed.data.email, code);
      if (!CAN_EXPOSE_EMAIL_FALLBACK_CODE) {
        return res.status(503).json({ message: EMAIL_DELIVERY_FAILED_MESSAGE });
      }
    }

    res.status(200).json({
      requiresVerification: true,
      email: parsed.data.email,
      ...getEmailFallbackFields(sent, code),
    });
  });

  router.post("/api/auth/verify-email", authRateLimiter, async (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const verification = await storage.getEmailVerification(parsed.data.email, parsed.data.code, "registration");
    if (!verification) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    const verificationAccountData = verification.accountData ?? (verification as { account_data?: string | null }).account_data;
    const accountData = typeof verificationAccountData === "string"
      ? JSON.parse(verificationAccountData)
      : verificationAccountData;

    if (!accountData) {
      return res.status(400).json({ message: "Invalid verification data" });
    }

    const existingUser = await storage.getAccountByUsername(accountData.username);
    if (existingUser) {
      return res.status(400).json({ message: "Username was taken while you were verifying. Please try again." });
    }

    const existingEmail = await storage.getAccountByEmail(accountData.email);
    if (existingEmail) {
      return res.status(400).json({ message: "Email was taken while you were verifying. Please try again." });
    }

    const account = await storage.createAccount({
      username: accountData.username,
      password: accountData.password,
      role: "manager",
      agencyName: accountData.agencyName,
      email: accountData.email,
      country: accountData.country || null,
    });

    await storage.markEmailVerificationUsed(verification.id);

    await startAccountSession(req, account);

    const { password, ...safe } = account;
    res.status(201).json({ user: safe });
  });

  router.post("/api/auth/forgot-password", authRateLimiter, async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const account = await storage.getAccountByEmail(parsed.data.email);
    if (!account) {
      return res.status(200).json({ success: true });
    }

    const code = generateCode();
    await storage.invalidatePendingVerifications(parsed.data.email, "recovery");
    await storage.createEmailVerification(parsed.data.email, code, "recovery", null, account.id);
    const sent = await sendVerificationEmail(parsed.data.email, code, "recovery");
    if (!sent) {
      logEmailSendFailure("Password reset", parsed.data.email, code);
    }

    res.status(200).json({
      success: true,
      ...(CAN_EXPOSE_EMAIL_FALLBACK_CODE ? getEmailFallbackFields(sent, code) : {}),
    });
  });

  router.post("/api/auth/reset-password", authRateLimiter, async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const verification = await storage.getEmailVerification(parsed.data.email, parsed.data.code, "recovery");
    if (!verification) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    const account = await storage.getAccountByEmail(parsed.data.email);
    if (!account) {
      return res.status(400).json({ message: "Account not found" });
    }

    const hashedPassword = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateAccountPassword(account.id, hashedPassword);
    await storage.markEmailVerificationUsed(verification.id);

    res.status(200).json({ success: true });
  });

  router.post("/api/auth/upgrade-employee", requireAuth, authRateLimiter, async (req, res) => {
    const parsed = upgradeEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const currentAccount = await storage.getAccount(req.session.userId!);
    if (!currentAccount || !currentAccount.username.startsWith("emp_")) {
      return res.status(400).json({ message: "Only temporary employee accounts can be upgraded" });
    }

    const existingUsername = await storage.getAccountByUsername(parsed.data.username);
    if (existingUsername && existingUsername.id !== req.session.userId) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const existingEmail = await storage.getAccountByEmail(parsed.data.email);
    if (existingEmail && existingEmail.id !== req.session.userId) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
    const code = generateCode();
    await storage.invalidatePendingVerifications(parsed.data.email, "employee-upgrade");
    await storage.createEmailVerification(parsed.data.email, code, "employee-upgrade", {
      username: parsed.data.username,
      passwordHash: hashedPassword,
      accountId: req.session.userId,
    }, req.session.userId);

    const sent = await sendVerificationEmail(parsed.data.email, code, "employee-upgrade");
    if (!sent) {
      logEmailSendFailure("Employee upgrade", parsed.data.email, code);
      if (!CAN_EXPOSE_EMAIL_FALLBACK_CODE) {
        return res.status(503).json({ message: EMAIL_DELIVERY_FAILED_MESSAGE });
      }
    }

    res.status(200).json({
      requiresVerification: true,
      email: parsed.data.email,
      ...getEmailFallbackFields(sent, code),
    });
  });

  router.post("/api/auth/verify-employee-upgrade", requireAuth, authRateLimiter, async (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const verification = await storage.getEmailVerification(parsed.data.email, parsed.data.code, "employee-upgrade");
    if (!verification) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    const verificationAccountData = verification.accountData ?? (verification as { account_data?: string | null }).account_data;
    const upgradeData = typeof verificationAccountData === "string"
      ? JSON.parse(verificationAccountData)
      : verificationAccountData;

    if (!upgradeData || upgradeData.accountId !== req.session.userId) {
      return res.status(400).json({ message: "Invalid verification data" });
    }

    const account = await storage.updateAccount(req.session.userId!, {
      username: upgradeData.username,
      password: upgradeData.passwordHash,
      email: parsed.data.email,
    });

    await storage.markEmailVerificationUsed(verification.id);

    if (account) {
      const { password, ...safe } = account;
      res.status(200).json({ user: safe });
    } else {
      res.status(500).json({ message: "Failed to update account" });
    }
  });

  router.post("/api/auth/login", authRateLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const account = await storage.getAccountByUsername(parsed.data.username);
    if (!account) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(parsed.data.password, account.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    await startAccountSession(req, account);

    const { password, ...safe } = account;
    let employee = null;
    if (account.employeeId) {
      employee = await storage.getEmployee(account.employeeId);
    }
    res.json({ user: safe, employee });
  });

  router.post("/api/auth/access-code", authRateLimiter, async (req, res) => {
    const parsed = accessCodeLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const ac = await storage.getAccessCodeByCode(parsed.data.code.trim());
    if (!ac) {
      return res.status(401).json({ message: "Invalid access code" });
    }

    if (ac.used) {
      return res.status(401).json({ message: "This access code has already been used" });
    }

    if (new Date() > new Date(ac.expiresAt)) {
      return res.status(401).json({ message: "This access code has expired" });
    }

    const employee = await storage.getEmployee(ac.employeeId);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    let account = employee.accountId
      ? await storage.getAccount(employee.accountId)
      : null;

    if (!account) {
      const hashedPassword = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
      account = await storage.createAccount({
        username: `emp_${employee.id}_${Date.now()}`,
        password: hashedPassword,
        role: "employee",
        employeeId: employee.id,
      });
      await storage.updateEmployee(employee.id, { accountId: account.id } as any);
    }

    await storage.markAccessCodeUsed(ac.id);

    await startAccountSession(req, account);

    const { password, ...safe } = account;
    res.json({ user: safe, employee });
  });

  router.post("/api/auth/steepin-login", kioskRateLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const account = await storage.getAccountByUsername(username);
    if (!account || !(await bcrypt.compare(password, account.password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    if (account.role !== "admin" && account.role !== "manager") {
      return res.status(403).json({ message: "SteepIn requires manager or admin access" });
    }
    await startAccountSession(req, account, { steepinMode: true });
    const { password: _, ...safe } = account;
    res.json({ user: safe });
  });

  router.post("/api/auth/steepin-restore", kioskRateLimiter, async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId || typeof deviceId !== "string") {
      return res.status(400).json({ message: "deviceId is required" });
    }
    const device = await storage.getLockedKioskDeviceByDeviceId(deviceId);
    if (!device) {
      return res.status(403).json({ message: "Device not found or not locked" });
    }
    const account = await storage.getAccount(device.ownerAccountId);
    if (!account || (account.role !== "admin" && account.role !== "manager")) {
      return res.status(403).json({ message: "Owner account not eligible for SteepIn" });
    }
    await startAccountSession(req, account, { steepinMode: true });
    res.json({ success: true });
  });

  router.post("/api/auth/steepin-exit", kioskRateLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Manager credentials required to exit SteepIn" });
    }

    const account = await storage.getAccountByUsername(username);
    if (!account || !(await bcrypt.compare(password, account.password))) {
      return res.status(401).json({ message: "Invalid manager credentials" });
    }

    if (account.role !== "admin" && account.role !== "manager") {
      return res.status(403).json({ message: "Only managers can exit SteepIn" });
    }

    req.session.destroy((err) => {
      if (err) return res.status(500).json({ message: "Failed to log out" });
      res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
      res.json({ success: true });
    });
  });

  router.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
      res.json({ success: true });
    });
  });

  router.post("/api/access-codes/generate", requireRole("admin", "manager"), async (req, res) => {
    const { employeeId } = req.body;
    if (!employeeId) {
      return res.status(400).json({ message: "Employee ID is required" });
    }

    const employee = await storage.getEmployee(Number(employeeId));
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (employee.status !== "active" || employee.hiddenFromSteepin) {
      return res.status(403).json({ message: "Cannot generate access codes for archived employees" });
    }

    const manager = await storage.getAccount(req.session.userId!);
    const agencyName = manager?.agencyName || "agency";

    await storage.expireAccessCodesForEmployee(employee.id);

    const code = generateAccessCode(agencyName, employee.name);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const ac = await storage.createAccessCode(code, employee.id, req.session.userId!, expiresAt);
    res.status(201).json(ac);
  });

  router.get("/api/access-codes/:employeeId", requireRole("admin", "manager"), async (req, res) => {
    const codes = await storage.getAccessCodesByEmployee(Number(req.params.employeeId));
    res.json(codes);
  });

  router.get("/api/kiosk/employees", async (req, res) => {
    const ownerAccountId = req.session?.userId;
    const emps = await storage.getEmployees(ownerAccountId);
    const safe = emps
      .filter((e) => e.status === "active" && !e.hiddenFromSteepin)
      .map(({ id, name, role, color }) => ({ id, name, role, color }));
    res.json(safe);
  });

  router.post("/api/kiosk/action", async (req, res) => {
    const { employeeId, type } = req.body;
    if (!employeeId || !type) {
      return res.status(400).json({ message: "employeeId and type are required" });
    }
    const validTypes = ["clock-in", "clock-out", "break-start", "break-end"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid action type" });
    }
    const employee = await storage.getEmployee(Number(employeeId));
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (employee.status !== "active" || employee.hiddenFromSteepin) {
      return res.status(403).json({ message: "Employee is archived" });
    }

    if (employee.accessCode !== req.body.passcode) {
      return res.status(401).json({ message: "Invalid passcode" });
    }

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const entry = await storage.createTimeEntry(employee.id, type, todayStr);
    res.status(201).json(entry);
  });

}
