import { eq, and, gt, desc, inArray, gte, lte, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  employees, shifts, accounts, accessCodes, timeEntries, customRoles, feedback, emailVerifications,
  approvalRequests, notifications, timesheetBackups,
  type Employee, type InsertEmployee,
  type Shift, type InsertShift,
  type Account, type InsertAccount,
  type AccessCode, type TimeEntry, type CustomRole, type Feedback, type EmailVerification,
  type ApprovalRequest, type Notification, type TimesheetBackup,
} from "@shared/schema";

const isProd = process.env.NODE_ENV === "production";
let connectionString = isProd
  ? (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL)
  : (process.env.DEV_DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);
if (connectionString) {
  const url = new URL(connectionString);
  url.searchParams.delete("channel_binding");
  connectionString = url.toString();
}
const isNeon = connectionString?.includes("neon.tech");
export const pool = new pg.Pool({
  connectionString,
  ssl: isNeon ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 300000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Database pool connection error (non-fatal):", err.message);
});

pool.query("SELECT 1").catch(() => {});
if (isNeon) {
  setInterval(async () => {
    try {
      await pool.query("SELECT 1");
    } catch (_) {}
  }, 90 * 1000);
}
const db = drizzle(pool);

function mapTimeEntryRow(row: any): TimeEntry {
  return {
    id: row.id,
    employeeId: row.employee_id,
    type: row.type,
    timestamp: row.timestamp,
    date: row.entry_date,
    role: row.role ?? null,
    notes: row.notes ?? null,
    isUnpaid: row.is_unpaid ?? false,
    source: row.source ?? "employee",
  };
}

export interface IStorage {
  getEmployees(ownerAccountId?: number): Promise<Employee[]>;
  getEmployee(id: number): Promise<Employee | undefined>;
  createEmployee(data: any): Promise<Employee>;
  updateEmployee(id: number, data: any): Promise<Employee | undefined>;
  deleteEmployee(id: number): Promise<void>;

  getShifts(ownerAccountId?: number): Promise<Shift[]>;
  getShiftsByDateRange(ownerAccountId: number | undefined, from: string, to: string): Promise<Shift[]>;
  getShift(id: number): Promise<Shift | undefined>;
  getShiftsByEmployee(employeeId: number): Promise<Shift[]>;
  getShiftsByEmployeeAndDate(employeeId: number, date: string): Promise<Shift[]>;
  getShiftsByEmployeeAndDateRange(employeeId: number, from: string, to: string): Promise<Shift[]>;
  createShift(data: any): Promise<Shift>;
  updateShift(id: number, data: any): Promise<Shift | undefined>;
  deleteShift(id: number): Promise<void>;
  updateShiftRolesForEmployee(employeeId: number, role: string, color: string): Promise<void>;

  getAccounts(): Promise<Account[]>;
  getAccount(id: number): Promise<Account | undefined>;
  getAccountByUsername(username: string): Promise<Account | undefined>;
  getAccountByEmail(email: string): Promise<Account | undefined>;
  createAccount(data: any): Promise<Account>;
  hasAnyManagers(): Promise<boolean>;

  createAccessCode(code: string, employeeId: number, createdBy: number, expiresAt: Date): Promise<AccessCode>;
  getAccessCodeByCode(code: string): Promise<AccessCode | undefined>;
  getAccessCodesByEmployee(employeeId: number): Promise<AccessCode[]>;
  markAccessCodeUsed(id: number): Promise<void>;
  expireAccessCodesForEmployee(employeeId: number): Promise<void>;

  createTimeEntry(employeeId: number, type: string, date: string, notes?: string | null): Promise<TimeEntry>;
  createTimeEntryManual(employeeId: number, type: string, date: string, timestamp: Date, role?: string | null, notes?: string | null, isUnpaid?: boolean, source?: string): Promise<TimeEntry>;
  getTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<TimeEntry[]>;
  getTimeEntriesByDate(date: string, ownerAccountId?: number): Promise<TimeEntry[]>;
  getTimeEntriesByDateRange(ownerAccountId: number | undefined, from: string, to: string, employeeId?: number): Promise<TimeEntry[]>;
  getAllTimeEntries(ownerAccountId?: number): Promise<TimeEntry[]>;
  getOpenSessionDate(employeeId: number): Promise<string | null>;
  getOpenSessionEntries(ownerAccountId: number): Promise<TimeEntry[]>;
  updateTimeEntry(id: number, data: Partial<TimeEntry>): Promise<TimeEntry | undefined>;
  deleteTimeEntry(id: number): Promise<void>;
  deleteTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<void>;
  batchDeleteTimeEntriesByIds(ids: number[], ownerAccountId: number): Promise<void>;
  batchCreateTimeEntries(entries: Array<{ employeeId: number; type: string; date: string; timestamp: Date; role?: string | null; notes?: string | null; isUnpaid?: boolean }>): Promise<void>;
  getEmployeeIdsByOwner(ownerAccountId: number): Promise<number[]>;

  getCustomRoles(ownerAccountId: number): Promise<CustomRole[]>;
  createCustomRole(ownerAccountId: number, name: string): Promise<CustomRole>;
  updateCustomRole(id: number, name: string, color?: string): Promise<CustomRole | undefined>;
  updateEmployeeColorsByRole(roleName: string, color: string, ownerAccountId: number): Promise<void>;
  deleteCustomRole(id: number): Promise<void>;

  getBreakPolicy(accountId: number): Promise<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }>;
  updateBreakPolicy(accountId: number, paidBreakMinutes: number | null, maxBreakMinutes: number | null): Promise<void>;

  createFeedback(accountId: number, message: string): Promise<Feedback>;
  getFeedbackCount24h(accountId: number): Promise<number>;
  getAllFeedback(): Promise<(Feedback & { username: string; email: string | null })[]>;

  deleteAccount(id: number): Promise<void>;

  createEmailVerification(email: string, code: string, type: string, accountData?: any, accountId?: number): Promise<EmailVerification>;
  getEmailVerification(email: string, code: string, type: string): Promise<EmailVerification | undefined>;
  markEmailVerificationUsed(id: number): Promise<void>;
  invalidatePendingVerifications(email: string, type: string): Promise<void>;
  updateAccountPassword(id: number, passwordHash: string): Promise<void>;
  updateAccountEmail(id: number, email: string): Promise<void>;
  updateAccount(id: number, data: Partial<Account>): Promise<Account | undefined>;

  createApprovalRequest(data: { employeeId: number; ownerAccountId: number; type: string; requestData?: string; entryDate?: string }): Promise<ApprovalRequest>;
  getApprovalRequestsByOwner(ownerAccountId: number, status?: string): Promise<ApprovalRequest[]>;
  getApprovalRequestsByEmployeeAndDate(employeeId: number, entryDate: string): Promise<ApprovalRequest[]>;
  updateApprovalRequest(id: number, data: Partial<ApprovalRequest>, ownerAccountId?: number): Promise<ApprovalRequest | undefined>;

  createNotification(data: { accountId: number; type: string; title: string; message: string; data?: string }): Promise<Notification>;
  getNotificationsByAccount(accountId: number, limit?: number): Promise<Notification[]>;
  getUnreadNotificationCount(accountId: number): Promise<number>;
  markNotificationRead(id: number, accountId: number): Promise<void>;
  markAllNotificationsRead(accountId: number): Promise<void>;

  getNotificationSettings(accountId: number): Promise<{ notifyLate: boolean; notifyEarlyClockOut: boolean; notifyNotes: boolean; notifyApprovals: boolean; lateThresholdMinutes: number; earlyClockOutThresholdMinutes: number; timezone: string }>;
  updateNotificationSettings(accountId: number, settings: { notifyLate?: boolean; notifyEarlyClockOut?: boolean; notifyNotes?: boolean; notifyApprovals?: boolean; lateThresholdMinutes?: number; earlyClockOutThresholdMinutes?: number; timezone?: string }): Promise<void>;

  createTimesheetBackup(ownerAccountId: number, label: string): Promise<TimesheetBackup>;
  getTimesheetBackups(ownerAccountId: number): Promise<Omit<TimesheetBackup, "snapshot">[]>;
  restoreTimesheetBackup(id: number, ownerAccountId: number): Promise<number>;
  deleteTimesheetBackup(id: number, ownerAccountId: number): Promise<void>;

  getLastClockOutForEmployee(employeeId: number): Promise<TimeEntry | null>;
  getAllAccounts(): Promise<Pick<Account, "id" | "username" | "agencyName" | "email" | "role" | "createdAt">[]>;

  getKioskDevices(ownerAccountId: number): Promise<any[]>;
  registerKioskDevice(ownerAccountId: number, deviceId: string, deviceName: string): Promise<any>;
  getLockedKioskDeviceByDeviceId(deviceId: string): Promise<{ ownerAccountId: number } | null>;
  updateKioskDeviceLock(id: number, ownerAccountId: number, isLocked: boolean): Promise<any>;
  deleteKioskDevice(id: number, ownerAccountId: number): Promise<void>;
  getKioskDeviceStatus(ownerAccountId: number, deviceId: string): Promise<{ isLocked: boolean } | null>;
  renameKioskDevice(id: number, ownerAccountId: number, deviceName: string): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getEmployees(ownerAccountId?: number): Promise<Employee[]> {
    if (ownerAccountId) {
      const result = await pool.query(
        `SELECT id, name, email, phone, role, department, color, status, avatar_initials as "avatarInitials", 
                account_id as "accountId", owner_account_id as "ownerAccountId", access_code as "accessCode",
                paid_break_minutes as "paidBreakMinutes", max_break_minutes as "maxBreakMinutes",
                hourly_rate as "hourlyRate", tier_enabled as "tierEnabled",
                tier_hours_threshold as "tierHoursThreshold", tier_overtime_rate as "tierOvertimeRate",
                special_day_enabled as "specialDayEnabled", special_day_of_week as "specialDayOfWeek",
                special_day_rate as "specialDayRate", custom_pay_days as "customPayDays",
                hidden_from_steepin as "hiddenFromSteepin"
         FROM employees 
         WHERE owner_account_id = $1
         ORDER BY name ASC`,
        [ownerAccountId]
      );
      return result.rows;
    }
    const result = await pool.query(
      `SELECT id, name, email, phone, role, department, color, status, avatar_initials as "avatarInitials", 
              account_id as "accountId", owner_account_id as "ownerAccountId", access_code as "accessCode",
              paid_break_minutes as "paidBreakMinutes", max_break_minutes as "maxBreakMinutes",
              hourly_rate as "hourlyRate", tier_enabled as "tierEnabled",
              tier_hours_threshold as "tierHoursThreshold", tier_overtime_rate as "tierOvertimeRate",
              special_day_enabled as "specialDayEnabled", special_day_of_week as "specialDayOfWeek",
              special_day_rate as "specialDayRate", custom_pay_days as "customPayDays",
              hidden_from_steepin as "hiddenFromSteepin"
       FROM employees 
       ORDER BY name ASC`
    );
    return result.rows;
  }

  async getEmployee(id: number): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.id, id));
    return emp;
  }

  async createEmployee(data: any): Promise<Employee> {
    const accessCode = data.accessCode || Math.floor(1000 + Math.random() * 9000).toString();
    const [emp] = await db.insert(employees).values({ ...data, accessCode }).returning();
    return emp;
  }

  async updateEmployee(id: number, data: any): Promise<Employee | undefined> {
    const [emp] = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
    return emp;
  }

  async deleteEmployee(id: number): Promise<void> {
    await db.delete(employees).where(eq(employees.id, id));
  }

  async getEmployeeIdsByOwner(ownerAccountId: number): Promise<number[]> {
    const rows = await db.select({ id: employees.id }).from(employees).where(eq(employees.ownerAccountId, ownerAccountId));
    return rows.map(r => r.id);
  }

  async getShifts(ownerAccountId?: number): Promise<Shift[]> {
    if (ownerAccountId) {
      const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
      if (empIds.length === 0) return [];
      return db.select().from(shifts).where(inArray(shifts.employeeId, empIds));
    }
    return db.select().from(shifts);
  }

  async getShiftsByDateRange(ownerAccountId: number | undefined, from: string, to: string): Promise<Shift[]> {
    if (ownerAccountId) {
      const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
      if (empIds.length === 0) return [];
      return db.select().from(shifts).where(
        and(inArray(shifts.employeeId, empIds), gte(shifts.date, from), lte(shifts.date, to))
      ).orderBy(asc(shifts.date), asc(shifts.startTime));
    }
    return db.select().from(shifts).where(
      and(gte(shifts.date, from), lte(shifts.date, to))
    ).orderBy(asc(shifts.date), asc(shifts.startTime));
  }

  async getShift(id: number): Promise<Shift | undefined> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
    return shift;
  }

  async getShiftsByEmployee(employeeId: number): Promise<Shift[]> {
    return db.select().from(shifts).where(eq(shifts.employeeId, employeeId));
  }

  async getShiftsByEmployeeAndDate(employeeId: number, date: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(eq(shifts.employeeId, employeeId), eq(shifts.date, date))
    );
  }

  async getShiftsByEmployeeAndDateRange(employeeId: number, from: string, to: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(eq(shifts.employeeId, employeeId), gte(shifts.date, from), lte(shifts.date, to))
    ).orderBy(asc(shifts.date), asc(shifts.startTime));
  }

  async updateEmployeeColorsByRole(roleName: string, color: string, ownerAccountId: number): Promise<void> {
    await pool.query(
      "UPDATE employees SET color = $1 WHERE role = $2 AND owner_account_id = $3",
      [color, roleName, ownerAccountId]
    );
  }

  async updateShiftRolesForEmployee(employeeId: number, role: string, color: string): Promise<void> {
    await pool.query(
      "UPDATE shifts SET role = $1, color = $2 WHERE employee_id = $3",
      [role, color, employeeId]
    );
  }

  async createShift(data: any): Promise<Shift> {
    const [shift] = await db.insert(shifts).values(data).returning();
    return shift;
  }

  async updateShift(id: number, data: any): Promise<Shift | undefined> {
    const [shift] = await db.update(shifts).set(data).where(eq(shifts.id, id)).returning();
    return shift;
  }

  async deleteShift(id: number): Promise<void> {
    await db.delete(shifts).where(eq(shifts.id, id));
  }

  async getAccounts(): Promise<Account[]> {
    return db.select().from(accounts);
  }

  async getAccount(id: number): Promise<Account | undefined> {
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, id));
    return acc;
  }

  async getAccountByUsername(username: string): Promise<Account | undefined> {
    const [acc] = await db.select().from(accounts).where(eq(accounts.username, username));
    return acc;
  }

  async getAccountByEmail(email: string): Promise<Account | undefined> {
    const [acc] = await db.select().from(accounts).where(eq(accounts.email, email));
    return acc;
  }

  async createAccount(data: any): Promise<Account> {
    const [acc] = await db.insert(accounts).values(data).returning();
    return acc;
  }

  async hasAnyManagers(): Promise<boolean> {
    const rows = await db.select().from(accounts);
    return rows.length > 0;
  }

  async createAccessCode(code: string, employeeId: number, createdBy: number, expiresAt: Date): Promise<AccessCode> {
    const [ac] = await db.insert(accessCodes).values({
      code,
      employeeId,
      createdBy,
      expiresAt,
      used: false,
    }).returning();
    return ac;
  }

  async getAccessCodeByCode(code: string): Promise<AccessCode | undefined> {
    const [ac] = await db.select().from(accessCodes).where(eq(accessCodes.code, code));
    return ac;
  }

  async getAccessCodesByEmployee(employeeId: number): Promise<AccessCode[]> {
    return db.select().from(accessCodes)
      .where(eq(accessCodes.employeeId, employeeId))
      .orderBy(desc(accessCodes.createdAt));
  }

  async markAccessCodeUsed(id: number): Promise<void> {
    await db.update(accessCodes).set({ used: true }).where(eq(accessCodes.id, id));
  }

  async expireAccessCodesForEmployee(employeeId: number): Promise<void> {
    await db.update(accessCodes)
      .set({ expiresAt: new Date() })
      .where(and(
        eq(accessCodes.employeeId, employeeId),
        gt(accessCodes.expiresAt, new Date()),
      ));
  }

  async createTimeEntry(employeeId: number, type: string, date: string, notes?: string | null): Promise<TimeEntry> {
    const [entry] = await db.insert(timeEntries).values({
      employeeId,
      type,
      date,
      timestamp: new Date(),
      source: "employee",
      ...(notes ? { notes } : {}),
    }).returning();
    return entry;
  }

  async createTimeEntryManual(employeeId: number, type: string, date: string, timestamp: Date, role?: string | null, notes?: string | null, isUnpaid?: boolean, source?: string): Promise<TimeEntry> {
    const [entry] = await db.insert(timeEntries).values({
      employeeId,
      type,
      date,
      timestamp,
      source: source || "manager",
      ...(role ? { role } : {}),
      ...(notes ? { notes } : {}),
      ...(isUnpaid ? { isUnpaid: true } : {}),
    }).returning();
    return entry;
  }

  async getTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<TimeEntry[]> {
    const result = await pool.query(
      "SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source FROM time_entries WHERE employee_id = $1 AND entry_date = $2 ORDER BY timestamp",
      [employeeId, date]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      type: row.type,
      timestamp: row.timestamp,
      date: row.entry_date,
      role: row.role ?? null,
      notes: row.notes ?? null,
      isUnpaid: row.is_unpaid ?? false,
      source: row.source ?? "employee",
    }));
  }

  async getTimeEntriesByDate(date: string, ownerAccountId?: number): Promise<TimeEntry[]> {
    if (ownerAccountId) {
      const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
      if (empIds.length === 0) return [];
      const placeholders = empIds.map((_, i) => `$${i + 2}`).join(',');
      const result = await pool.query(
        `SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source FROM time_entries WHERE entry_date = $1 AND employee_id IN (${placeholders}) ORDER BY timestamp`,
        [date, ...empIds]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        type: row.type,
        timestamp: row.timestamp,
        date: row.entry_date,
        role: row.role ?? null,
        notes: row.notes ?? null,
        isUnpaid: row.is_unpaid ?? false,
        source: row.source ?? "employee",
      }));
    }
    const result = await pool.query(
      "SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source FROM time_entries WHERE entry_date = $1 ORDER BY timestamp",
      [date]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      type: row.type,
      timestamp: row.timestamp,
      date: row.entry_date,
      role: row.role ?? null,
      notes: row.notes ?? null,
      isUnpaid: row.is_unpaid ?? false,
      source: row.source ?? "employee",
    }));
  }

  async getTimeEntriesByDateRange(ownerAccountId: number | undefined, from: string, to: string, employeeId?: number): Promise<TimeEntry[]> {
    const params: any[] = [from, to];
    const clauses = ["entry_date >= $1", "entry_date <= $2"];

    if (employeeId) {
      params.push(employeeId);
      clauses.push(`employee_id = $${params.length}`);
    }

    if (ownerAccountId) {
      params.push(ownerAccountId);
      clauses.push(`employee_id IN (SELECT id FROM employees WHERE owner_account_id = $${params.length})`);
    }

    const result = await pool.query(
      `SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source
       FROM time_entries
       WHERE ${clauses.join(" AND ")}
       ORDER BY timestamp`,
      params
    );
    return result.rows.map(mapTimeEntryRow);
  }

  async getAllTimeEntries(ownerAccountId?: number): Promise<TimeEntry[]> {
    if (ownerAccountId) {
      const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
      if (empIds.length === 0) return [];
      const placeholders = empIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(
        `SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source FROM time_entries WHERE employee_id IN (${placeholders}) ORDER BY timestamp`,
        [...empIds]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        type: row.type,
        timestamp: row.timestamp,
        date: row.entry_date,
        role: row.role ?? null,
        notes: row.notes ?? null,
        isUnpaid: row.is_unpaid ?? false,
        source: row.source ?? "employee",
      }));
    }
    const result = await pool.query("SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source FROM time_entries ORDER BY timestamp");
    return result.rows.map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      type: row.type,
      timestamp: row.timestamp,
      date: row.entry_date,
      role: row.role ?? null,
      notes: row.notes ?? null,
      isUnpaid: row.is_unpaid ?? false,
      source: row.source ?? "employee",
    }));
  }

  async getOpenSessionDate(employeeId: number): Promise<string | null> {
    const result = await pool.query(
      `SELECT entry_date::text as date
       FROM time_entries
       WHERE employee_id = $1
         AND timestamp > NOW() - INTERVAL '48 hours'
       ORDER BY timestamp DESC
       LIMIT 10`,
      [employeeId]
    );
    if (result.rows.length === 0) return null;

    const uniqueDates = [...new Set(result.rows.map(r => r.date))];
    const entries = await pool.query(
      `SELECT type, entry_date::text as date, timestamp 
       FROM time_entries 
       WHERE employee_id = $1 AND entry_date = ANY($2)
       ORDER BY timestamp DESC`,
      [employeeId, uniqueDates]
    );

    const entriesByDate: Record<string, any[]> = {};
    entries.rows.forEach(r => {
      if (!entriesByDate[r.date]) entriesByDate[r.date] = [];
      entriesByDate[r.date].push(r);
    });

    for (const date of uniqueDates) {
      const dayEntries = entriesByDate[date] || [];
      const hasClockOut = dayEntries.some(e => e.type === 'clock-out');
      const hasClockIn = dayEntries.some(e => e.type === 'clock-in');
      if (hasClockIn && !hasClockOut) return date;
    }
    return null;
  }

  async getOpenSessionEntries(ownerAccountId: number): Promise<TimeEntry[]> {
    const result = await pool.query(
      `WITH owner_employees AS (
         SELECT id FROM employees WHERE owner_account_id = $1
       ),
       open_dates AS (
         SELECT DISTINCT ON (t2.employee_id) t2.employee_id, t2.entry_date
         FROM time_entries t2
         JOIN owner_employees oe ON oe.id = t2.employee_id
         WHERE t2.type = 'clock-in'
           AND t2.timestamp > NOW() - INTERVAL '24 hours'
           AND NOT EXISTS (
             SELECT 1 FROM time_entries t3
             WHERE t3.employee_id = t2.employee_id
               AND t3.entry_date = t2.entry_date
               AND t3.type = 'clock-out'
               AND t3.timestamp > t2.timestamp
           )
         ORDER BY t2.employee_id, t2.entry_date DESC, t2.timestamp DESC
       )
       SELECT t.id, t.employee_id, t.type, t.timestamp, t.entry_date::text, t.role, t.notes, t.is_unpaid, t.source
       FROM time_entries t
       JOIN open_dates od ON od.employee_id = t.employee_id AND od.entry_date = t.entry_date
       ORDER BY t.timestamp`,
      [ownerAccountId]
    );
    return result.rows.map(mapTimeEntryRow);
  }

  async updateTimeEntry(id: number, data: Partial<TimeEntry>): Promise<TimeEntry | undefined> {
    const [entry] = await db.update(timeEntries).set(data).where(eq(timeEntries.id, id)).returning();
    return entry;
  }

  async deleteTimeEntry(id: number): Promise<void> {
    await db.delete(timeEntries).where(eq(timeEntries.id, id));
  }

  async deleteTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<void> {
    await pool.query(
      "DELETE FROM time_entries WHERE employee_id = $1 AND entry_date = $2",
      [employeeId, date]
    );
  }

  async batchDeleteTimeEntriesByIds(ids: number[], ownerAccountId: number): Promise<void> {
    if (ids.length === 0) return;
    await pool.query(
      "DELETE FROM time_entries WHERE id = ANY($1) AND employee_id IN (SELECT id FROM employees WHERE owner_account_id = $2)",
      [ids, ownerAccountId]
    );
  }

  async batchCreateTimeEntries(entries: Array<{ employeeId: number; type: string; date: string; timestamp: Date; role?: string | null; notes?: string | null; isUnpaid?: boolean }>): Promise<void> {
    if (entries.length === 0) return;
    const CHUNK = 200;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const values = chunk.map((_, j) => {
        const b = j * 8;
        return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, $${b+6}, $${b+7}, $${b+8})`;
      }).join(", ");
      const params = chunk.flatMap(e => [
        e.employeeId, e.type, e.timestamp, e.date,
        e.role ?? null, e.notes ?? null, e.isUnpaid ?? false, "manager"
      ]);
      await pool.query(
        `INSERT INTO time_entries (employee_id, type, timestamp, entry_date, role, notes, is_unpaid, source) VALUES ${values}`,
        params
      );
    }
  }

  async getCustomRoles(ownerAccountId: number): Promise<CustomRole[]> {
    const res = await pool.query(
      "SELECT * FROM custom_roles WHERE owner_account_id = $1 ORDER BY id ASC",
      [ownerAccountId]
    );
    return res.rows;
  }

  async createCustomRole(ownerAccountId: number, name: string, color?: string): Promise<CustomRole> {
    const res = await pool.query(
      "INSERT INTO custom_roles (name, color, owner_account_id) VALUES ($1, $2, $3) RETURNING *",
      [name, color || "#8B9E8B", ownerAccountId]
    );
    return res.rows[0];
  }

  async updateCustomRole(id: number, name: string, color?: string): Promise<CustomRole | undefined> {
    const res = await pool.query(
      "UPDATE custom_roles SET name = $1, color = $2 WHERE id = $3 RETURNING *",
      [name, color || "#8B9E8B", id]
    );
    return res.rows[0];
  }

  async deleteCustomRole(id: number): Promise<void> {
    await db.delete(customRoles).where(eq(customRoles.id, id));
  }

  async getBreakPolicy(accountId: number): Promise<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }> {
    const res = await pool.query("SELECT paid_break_minutes, max_break_minutes FROM accounts WHERE id = $1", [accountId]);
    const row = res.rows[0];
    if (!row) return { paidBreakMinutes: null, maxBreakMinutes: null };
    return { paidBreakMinutes: row.paid_break_minutes, maxBreakMinutes: row.max_break_minutes };
  }

  async updateBreakPolicy(accountId: number, paidBreakMinutes: number | null, maxBreakMinutes: number | null): Promise<void> {
    await pool.query(
      "UPDATE accounts SET paid_break_minutes = $1, max_break_minutes = $2 WHERE id = $3",
      [paidBreakMinutes, maxBreakMinutes, accountId]
    );
  }

  async updateEmployeeBreakPolicy(employeeId: number, ownerAccountId: number, paidBreakMinutes: number | null, maxBreakMinutes: number | null): Promise<Employee | null> {
    const res = await pool.query(
      "UPDATE employees SET paid_break_minutes = $1, max_break_minutes = $2 WHERE id = $3 AND owner_account_id = $4 RETURNING *",
      [paidBreakMinutes, maxBreakMinutes, employeeId, ownerAccountId]
    );
    return res.rows[0] ?? null;
  }

  async createFeedback(accountId: number, message: string): Promise<Feedback> {
    const [entry] = await db.insert(feedback).values({ accountId, message }).returning();
    return entry;
  }

  async getFeedbackCount24h(accountId: number): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await pool.query(
      "SELECT COUNT(*) FROM feedback WHERE account_id = $1 AND created_at >= $2",
      [accountId, since]
    );
    return parseInt(res.rows[0].count, 10);
  }

  async deleteAccount(id: number): Promise<void> {
    const empIds = await this.getEmployeeIdsByOwner(id);
    if (empIds.length > 0) {
      await db.delete(employees).where(inArray(employees.id, empIds));
    }
    await pool.query("DELETE FROM custom_roles WHERE owner_account_id = $1", [id]);
    await db.delete(accounts).where(eq(accounts.id, id));
  }

  async createEmailVerification(email: string, code: string, type: string, accountData?: any, accountId?: number): Promise<EmailVerification> {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const res = await pool.query(
      `INSERT INTO email_verifications (email, code, type, account_data, account_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [email, code, type, accountData ? JSON.stringify(accountData) : null, accountId || null, expiresAt]
    );
    return res.rows[0];
  }

  async getEmailVerification(email: string, code: string, type: string): Promise<EmailVerification | undefined> {
    const res = await pool.query(
      `SELECT * FROM email_verifications
       WHERE email = $1 AND code = $2 AND type = $3 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code, type]
    );
    return res.rows[0];
  }

  async markEmailVerificationUsed(id: number): Promise<void> {
    await pool.query("UPDATE email_verifications SET used = true WHERE id = $1", [id]);
  }

  async invalidatePendingVerifications(email: string, type: string): Promise<void> {
    await pool.query(
      "UPDATE email_verifications SET used = true WHERE email = $1 AND type = $2 AND used = false",
      [email, type]
    );
  }

  async updateAccountPassword(id: number, passwordHash: string): Promise<void> {
    await pool.query("UPDATE accounts SET password = $1 WHERE id = $2", [passwordHash, id]);
  }

  async updateAccountEmail(id: number, email: string): Promise<void> {
    await pool.query("UPDATE accounts SET email = $1 WHERE id = $2", [email, id]);
  }

  async updateAccount(id: number, data: Partial<Account>): Promise<Account | undefined> {
    const [acc] = await db.update(accounts).set(data).where(eq(accounts.id, id)).returning();
    return acc;
  }

  async getAllFeedback(): Promise<(Feedback & { username: string; email: string | null })[]> {
    const res = await pool.query(
      `SELECT f.id, f.account_id, f.message, f.created_at, a.username, a.email
       FROM feedback f
       LEFT JOIN accounts a ON a.id = f.account_id
       ORDER BY f.created_at DESC`
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      accountId: r.account_id,
      message: r.message,
      createdAt: r.created_at,
      username: r.username ?? "Deleted Account",
      email: r.email ?? null,
    }));
  }

  async createApprovalRequest(data: { employeeId: number; ownerAccountId: number; type: string; requestData?: string; entryDate?: string }): Promise<ApprovalRequest> {
    const res = await pool.query(
      `INSERT INTO approval_requests (employee_id, owner_account_id, type, request_data, entry_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.employeeId, data.ownerAccountId, data.type, data.requestData || null, data.entryDate || null]
    );
    const r = res.rows[0];
    return { id: r.id, employeeId: r.employee_id, ownerAccountId: r.owner_account_id, type: r.type, status: r.status, requestData: r.request_data, managerResponse: r.manager_response, entryDate: r.entry_date, createdAt: r.created_at, resolvedAt: r.resolved_at };
  }

  async getApprovalRequestsByOwner(ownerAccountId: number, status?: string): Promise<ApprovalRequest[]> {
    let query = "SELECT * FROM approval_requests WHERE owner_account_id = $1";
    const params: any[] = [ownerAccountId];
    if (status) {
      query += " AND status = $2";
      params.push(status);
    }
    query += " ORDER BY created_at DESC";
    const res = await pool.query(query, params);
    return res.rows.map((r: any) => ({ id: r.id, employeeId: r.employee_id, ownerAccountId: r.owner_account_id, type: r.type, status: r.status, requestData: r.request_data, managerResponse: r.manager_response, entryDate: r.entry_date, createdAt: r.created_at, resolvedAt: r.resolved_at }));
  }

  async getApprovalRequestsByEmployeeAndDate(employeeId: number, entryDate: string): Promise<ApprovalRequest[]> {
    const res = await pool.query(
      "SELECT * FROM approval_requests WHERE employee_id = $1 AND entry_date = $2 ORDER BY created_at DESC",
      [employeeId, entryDate]
    );
    return res.rows.map((r: any) => ({ id: r.id, employeeId: r.employee_id, ownerAccountId: r.owner_account_id, type: r.type, status: r.status, requestData: r.request_data, managerResponse: r.manager_response, entryDate: r.entry_date, createdAt: r.created_at, resolvedAt: r.resolved_at }));
  }

  async updateApprovalRequest(id: number, data: Partial<ApprovalRequest>, ownerAccountId?: number): Promise<ApprovalRequest | undefined> {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); params.push(data.status); }
    if (data.managerResponse !== undefined) { sets.push(`manager_response = $${idx++}`); params.push(data.managerResponse); }
    if (data.resolvedAt !== undefined) { sets.push(`resolved_at = $${idx++}`); params.push(data.resolvedAt); }
    if (sets.length === 0) return undefined;
    params.push(id);
    let whereClause = `WHERE id = $${idx++}`;
    if (ownerAccountId !== undefined) {
      params.push(ownerAccountId);
      whereClause += ` AND owner_account_id = $${idx}`;
    }
    const res = await pool.query(`UPDATE approval_requests SET ${sets.join(', ')} ${whereClause} RETURNING *`, params);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];
    return { id: r.id, employeeId: r.employee_id, ownerAccountId: r.owner_account_id, type: r.type, status: r.status, requestData: r.request_data, managerResponse: r.manager_response, entryDate: r.entry_date, createdAt: r.created_at, resolvedAt: r.resolved_at };
  }

  async createNotification(data: { accountId: number; type: string; title: string; message: string; data?: string }): Promise<Notification> {
    const res = await pool.query(
      `INSERT INTO notifications (account_id, type, title, message, data)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.accountId, data.type, data.title, data.message, data.data || null]
    );
    const r = res.rows[0];
    return { id: r.id, accountId: r.account_id, type: r.type, title: r.title, message: r.message, data: r.data, read: r.read, createdAt: r.created_at };
  }

  async getNotificationsByAccount(accountId: number, limit: number = 50): Promise<Notification[]> {
    const res = await pool.query(
      "SELECT * FROM notifications WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2",
      [accountId, limit]
    );
    return res.rows.map((r: any) => ({ id: r.id, accountId: r.account_id, type: r.type, title: r.title, message: r.message, data: r.data, read: r.read, createdAt: r.created_at }));
  }

  async getUnreadNotificationCount(accountId: number): Promise<number> {
    const res = await pool.query(
      "SELECT COUNT(*) FROM notifications WHERE account_id = $1 AND read = false",
      [accountId]
    );
    return parseInt(res.rows[0].count, 10);
  }

  async markNotificationRead(id: number, accountId: number): Promise<void> {
    await pool.query("UPDATE notifications SET read = true WHERE id = $1 AND account_id = $2", [id, accountId]);
  }

  async markAllNotificationsRead(accountId: number): Promise<void> {
    await pool.query("UPDATE notifications SET read = true WHERE account_id = $1 AND read = false", [accountId]);
  }

  async getNotificationSettings(accountId: number): Promise<{ notifyLate: boolean; notifyEarlyClockOut: boolean; notifyNotes: boolean; notifyApprovals: boolean; lateThresholdMinutes: number; earlyClockOutThresholdMinutes: number; timezone: string }> {
    const res = await pool.query(
      "SELECT notify_late, notify_early_clock_out, notify_notes, notify_approvals, late_threshold_minutes, early_clock_out_threshold_minutes, timezone FROM accounts WHERE id = $1",
      [accountId]
    );
    const r = res.rows[0];
    if (!r) return { notifyLate: true, notifyEarlyClockOut: true, notifyNotes: true, notifyApprovals: true, lateThresholdMinutes: 15, earlyClockOutThresholdMinutes: 15, timezone: "UTC" };
    return {
      notifyLate: r.notify_late ?? true,
      notifyEarlyClockOut: r.notify_early_clock_out ?? true,
      notifyNotes: r.notify_notes ?? true,
      notifyApprovals: r.notify_approvals ?? true,
      lateThresholdMinutes: r.late_threshold_minutes ?? 15,
      earlyClockOutThresholdMinutes: r.early_clock_out_threshold_minutes ?? 15,
      timezone: r.timezone ?? "UTC",
    };
  }

  async updateNotificationSettings(accountId: number, settings: { notifyLate?: boolean; notifyEarlyClockOut?: boolean; notifyNotes?: boolean; notifyApprovals?: boolean; lateThresholdMinutes?: number; earlyClockOutThresholdMinutes?: number; timezone?: string }): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (settings.notifyLate !== undefined) { sets.push(`notify_late = $${idx++}`); params.push(settings.notifyLate); }
    if (settings.notifyEarlyClockOut !== undefined) { sets.push(`notify_early_clock_out = $${idx++}`); params.push(settings.notifyEarlyClockOut); }
    if (settings.notifyNotes !== undefined) { sets.push(`notify_notes = $${idx++}`); params.push(settings.notifyNotes); }
    if (settings.notifyApprovals !== undefined) { sets.push(`notify_approvals = $${idx++}`); params.push(settings.notifyApprovals); }
    if (settings.lateThresholdMinutes !== undefined) { sets.push(`late_threshold_minutes = $${idx++}`); params.push(settings.lateThresholdMinutes); }
    if (settings.earlyClockOutThresholdMinutes !== undefined) { sets.push(`early_clock_out_threshold_minutes = $${idx++}`); params.push(settings.earlyClockOutThresholdMinutes); }
    if (settings.timezone !== undefined) { sets.push(`timezone = $${idx++}`); params.push(settings.timezone); }
    if (sets.length === 0) return;
    params.push(accountId);
    await pool.query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  }

  async getLastClockOutForEmployee(employeeId: number): Promise<TimeEntry | null> {
    const res = await pool.query(
      "SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source FROM time_entries WHERE employee_id = $1 AND type = 'clock-out' ORDER BY timestamp DESC LIMIT 1",
      [employeeId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { id: r.id, employeeId: r.employee_id, type: r.type, timestamp: r.timestamp, date: r.entry_date, role: r.role ?? null, notes: r.notes ?? null, isUnpaid: r.is_unpaid ?? false, source: r.source ?? "employee" };
  }

  async getAllAccounts(): Promise<Pick<Account, "id" | "username" | "agencyName" | "email" | "role" | "createdAt">[]> {
    const result = await pool.query(
      `SELECT id, username, agency_name as "agencyName", email, role, created_at as "createdAt"
       FROM accounts
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  async createTimesheetBackup(ownerAccountId: number, label: string): Promise<TimesheetBackup> {
    const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
    let entries: any[] = [];
    if (empIds.length > 0) {
      const res = await pool.query(
        "SELECT id, employee_id, type, timestamp, entry_date::text, role, notes, is_unpaid, source FROM time_entries WHERE employee_id = ANY($1) ORDER BY timestamp ASC",
        [empIds]
      );
      entries = res.rows;
    }
    const snapshot = JSON.stringify(entries);
    const result = await pool.query(
      "INSERT INTO timesheet_backups (owner_account_id, label, entry_count, snapshot) VALUES ($1, $2, $3, $4) RETURNING *",
      [ownerAccountId, label, entries.length, snapshot]
    );
    const row = result.rows[0];
    await pool.query(
      "DELETE FROM timesheet_backups WHERE owner_account_id = $1 AND id NOT IN (SELECT id FROM timesheet_backups WHERE owner_account_id = $1 ORDER BY created_at DESC LIMIT 10)",
      [ownerAccountId]
    );
    return { id: row.id, ownerAccountId: row.owner_account_id, label: row.label, entryCount: row.entry_count, snapshot: row.snapshot, createdAt: row.created_at };
  }

  async getTimesheetBackups(ownerAccountId: number): Promise<Omit<TimesheetBackup, "snapshot">[]> {
    const res = await pool.query(
      "SELECT id, owner_account_id, label, entry_count, created_at FROM timesheet_backups WHERE owner_account_id = $1 ORDER BY created_at DESC",
      [ownerAccountId]
    );
    return res.rows.map(r => ({ id: r.id, ownerAccountId: r.owner_account_id, label: r.label, entryCount: r.entry_count, createdAt: r.created_at }));
  }

  async restoreTimesheetBackup(id: number, ownerAccountId: number): Promise<number> {
    const res = await pool.query(
      "SELECT snapshot, entry_count FROM timesheet_backups WHERE id = $1 AND owner_account_id = $2",
      [id, ownerAccountId]
    );
    if (res.rows.length === 0) throw new Error("Backup not found");
    const entries: any[] = JSON.parse(res.rows[0].snapshot);
    const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
    if (empIds.length > 0) {
      await pool.query("DELETE FROM time_entries WHERE employee_id = ANY($1)", [empIds]);
    }
    if (entries.length > 0) {
      const values = entries.map((_, i) => {
        const base = i * 7;
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7})`;
      }).join(", ");
      const params = entries.flatMap(e => [e.employee_id, e.type, e.timestamp, e.entry_date, e.role ?? null, e.notes ?? null, e.is_unpaid ?? false]);
      await pool.query(
        `INSERT INTO time_entries (employee_id, type, timestamp, entry_date, role, notes, is_unpaid) VALUES ${values}`,
        params
      );
    }
    return entries.length;
  }

  async deleteTimesheetBackup(id: number, ownerAccountId: number): Promise<void> {
    await pool.query("DELETE FROM timesheet_backups WHERE id = $1 AND owner_account_id = $2", [id, ownerAccountId]);
  }

  async getKioskDevices(ownerAccountId: number): Promise<any[]> {
    const res = await pool.query(
      `SELECT id, owner_account_id as "ownerAccountId", device_id as "deviceId", device_name as "deviceName", is_locked as "isLocked", last_seen as "lastSeen"
       FROM kiosk_devices WHERE owner_account_id = $1 ORDER BY last_seen DESC`,
      [ownerAccountId]
    );
    return res.rows;
  }

  async registerKioskDevice(ownerAccountId: number, deviceId: string, deviceName: string): Promise<any> {
    const existing = await pool.query(
      "SELECT id FROM kiosk_devices WHERE owner_account_id = $1 AND device_id = $2",
      [ownerAccountId, deviceId]
    );
    if (existing.rows.length > 0) {
      const res = await pool.query(
        `UPDATE kiosk_devices SET device_name = $1, last_seen = NOW() WHERE id = $2
         RETURNING id, owner_account_id as "ownerAccountId", device_id as "deviceId", device_name as "deviceName", is_locked as "isLocked", last_seen as "lastSeen"`,
        [deviceName, existing.rows[0].id]
      );
      return res.rows[0];
    }
    const res = await pool.query(
      `INSERT INTO kiosk_devices (owner_account_id, device_id, device_name, is_locked, last_seen)
       VALUES ($1, $2, $3, false, NOW())
       RETURNING id, owner_account_id as "ownerAccountId", device_id as "deviceId", device_name as "deviceName", is_locked as "isLocked", last_seen as "lastSeen"`,
      [ownerAccountId, deviceId, deviceName]
    );
    return res.rows[0];
  }

  async updateKioskDeviceLock(id: number, ownerAccountId: number, isLocked: boolean): Promise<any> {
    const res = await pool.query(
      `UPDATE kiosk_devices SET is_locked = $1 WHERE id = $2 AND owner_account_id = $3
       RETURNING id, owner_account_id as "ownerAccountId", device_id as "deviceId", device_name as "deviceName", is_locked as "isLocked", last_seen as "lastSeen"`,
      [isLocked, id, ownerAccountId]
    );
    return res.rows[0];
  }

  async deleteKioskDevice(id: number, ownerAccountId: number): Promise<void> {
    await pool.query("DELETE FROM kiosk_devices WHERE id = $1 AND owner_account_id = $2", [id, ownerAccountId]);
  }

  async getKioskDeviceStatus(ownerAccountId: number, deviceId: string): Promise<{ isLocked: boolean } | null> {
    const res = await pool.query(
      "SELECT is_locked as \"isLocked\" FROM kiosk_devices WHERE owner_account_id = $1 AND device_id = $2",
      [ownerAccountId, deviceId]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async getLockedKioskDeviceByDeviceId(deviceId: string): Promise<{ ownerAccountId: number } | null> {
    const res = await pool.query(
      `SELECT owner_account_id as "ownerAccountId" FROM kiosk_devices WHERE device_id = $1 AND is_locked = true LIMIT 1`,
      [deviceId]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async renameKioskDevice(id: number, ownerAccountId: number, deviceName: string): Promise<any> {
    const res = await pool.query(
      `UPDATE kiosk_devices SET device_name = $1 WHERE id = $2 AND owner_account_id = $3
       RETURNING id, owner_account_id as "ownerAccountId", device_id as "deviceId", device_name as "deviceName", is_locked as "isLocked", last_seen as "lastSeen"`,
      [deviceName, id, ownerAccountId]
    );
    return res.rows[0];
  }
}

export const storage = new DatabaseStorage();
