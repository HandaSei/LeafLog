import { Router, Request, Response, NextFunction } from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { storage } from "./storage";
import { loginSchema, registerManagerSchema, accessCodeLoginSchema, registerAccountSchema } from "@shared/schema";
import { format } from "date-fns";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
    employeeId: number | null;
    steepinMode: boolean;
  }
}

export function setupSession(app: any) {
  const PgStore = pgSession(session);

  app.use(
    session({
      store: new PgStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "shiftflow-secret-key-change-me",
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
        httpOnly: true,
        secure: false,
        sameSite: "lax",
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
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!roles.includes(req.session.role!)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

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

  router.post("/api/auth/register-manager", async (req, res) => {
    const parsed = registerManagerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const hasManagers = await storage.hasAnyManagers();
    if (hasManagers) {
      return res.status(400).json({ message: "A manager account already exists. Contact your admin." });
    }

    const existing = await storage.getAccountByUsername(parsed.data.username);
    if (existing) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
    const account = await storage.createAccount({
      username: parsed.data.username,
      password: hashedPassword,
      role: "manager",
      agencyName: parsed.data.agencyName,
    });

    req.session.userId = account.id;
    req.session.role = account.role;
    req.session.employeeId = null;

    const { password, ...safe } = account;
    res.status(201).json({ user: safe });
  });

  router.post("/api/auth/register", async (req, res) => {
    const parsed = registerAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const existing = await storage.getAccountByUsername(parsed.data.username);
    if (existing) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const allAccounts = await storage.getAccountByEmail(parsed.data.email);
    if (allAccounts) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
    const account = await storage.createAccount({
      username: parsed.data.username,
      password: hashedPassword,
      email: parsed.data.email,
      role: "employee",
    });

    req.session.userId = account.id;
    req.session.role = account.role;
    req.session.employeeId = null;

    const { password, ...safe } = account;
    res.status(201).json({ user: safe });
  });

  router.post("/api/auth/login", async (req, res) => {
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

    req.session.userId = account.id;
    req.session.role = account.role;
    req.session.employeeId = account.employeeId;

    const { password, ...safe } = account;
    let employee = null;
    if (account.employeeId) {
      employee = await storage.getEmployee(account.employeeId);
    }
    res.json({ user: safe, employee });
  });

  router.post("/api/auth/access-code", async (req, res) => {
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

    req.session.userId = account.id;
    req.session.role = "employee";
    req.session.employeeId = employee.id;

    const { password, ...safe } = account;
    res.json({ user: safe, employee });
  });

  router.post("/api/auth/steepin-login", async (req, res) => {
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
    req.session.userId = account.id;
    req.session.role = account.role;
    req.session.steepinMode = true;
    const { password: _, ...safe } = account;
    res.json({ user: safe });
  });

  router.post("/api/auth/steepin-exit", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  router.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
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

  // === SteepIn (no auth required) ===
  router.get("/api/kiosk/employees", async (_req, res) => {
    const emps = await storage.getEmployees();
    const safe = emps
      .filter((e) => e.status === "active")
      .map(({ id, name, role, department, color }) => ({ id, name, role, department, color }));
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

    if (employee.accessCode !== req.body.passcode) {
      return res.status(401).json({ message: "Invalid passcode" });
    }

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const entry = await storage.createTimeEntry(employee.id, type, todayStr);
    res.status(201).json(entry);
  });

  router.get("/api/kiosk/entries/:employeeId", async (req, res) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const entries = await storage.getTimeEntriesByEmployeeAndDate(Number(req.params.employeeId), todayStr);
    res.json(entries);
  });

  router.get("/api/kiosk/entries", async (_req, res) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const entries = await storage.getTimeEntriesByDate(todayStr);
    res.json(entries);
  });
}
