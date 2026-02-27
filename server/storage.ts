import { eq, and, gt, desc, inArray, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  employees, shifts, accounts, accessCodes, timeEntries, customRoles, feedback,
  type Employee, type InsertEmployee,
  type Shift, type InsertShift,
  type Account, type InsertAccount,
  type AccessCode, type TimeEntry, type CustomRole, type Feedback,
} from "@shared/schema";

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const isNeon = connectionString?.includes("neon.tech");
export const pool = new pg.Pool({
  connectionString,
  ssl: isNeon ? { rejectUnauthorized: false } : undefined,
});
const db = drizzle(pool);

export interface IStorage {
  getEmployees(ownerAccountId?: number): Promise<Employee[]>;
  getEmployee(id: number): Promise<Employee | undefined>;
  createEmployee(data: any): Promise<Employee>;
  updateEmployee(id: number, data: any): Promise<Employee | undefined>;
  deleteEmployee(id: number): Promise<void>;

  getShifts(ownerAccountId?: number): Promise<Shift[]>;
  getShift(id: number): Promise<Shift | undefined>;
  getShiftsByEmployee(employeeId: number): Promise<Shift[]>;
  createShift(data: any): Promise<Shift>;
  updateShift(id: number, data: any): Promise<Shift | undefined>;
  deleteShift(id: number): Promise<void>;

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

  createTimeEntry(employeeId: number, type: string, date: string): Promise<TimeEntry>;
  createTimeEntryManual(employeeId: number, type: string, date: string, timestamp: Date): Promise<TimeEntry>;
  getTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<TimeEntry[]>;
  getTimeEntriesByDate(date: string, ownerAccountId?: number): Promise<TimeEntry[]>;
  getAllTimeEntries(ownerAccountId?: number): Promise<TimeEntry[]>;
  updateTimeEntry(id: number, data: Partial<TimeEntry>): Promise<TimeEntry | undefined>;
  deleteTimeEntry(id: number): Promise<void>;
  deleteTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<void>;
  getEmployeeIdsByOwner(ownerAccountId: number): Promise<number[]>;

  getCustomRoles(ownerAccountId: number): Promise<CustomRole[]>;
  createCustomRole(ownerAccountId: number, name: string): Promise<CustomRole>;
  updateCustomRole(id: number, name: string): Promise<CustomRole | undefined>;
  deleteCustomRole(id: number): Promise<void>;

  getBreakPolicy(accountId: number): Promise<{ paidBreakMinutes: number | null; maxBreakMinutes: number | null }>;
  updateBreakPolicy(accountId: number, paidBreakMinutes: number | null, maxBreakMinutes: number | null): Promise<void>;

  createFeedback(accountId: number, message: string): Promise<Feedback>;
  getFeedbackCount24h(accountId: number): Promise<number>;
  getAllFeedback(): Promise<(Feedback & { username: string; email: string | null })[]>;
}

export class DatabaseStorage implements IStorage {
  async getEmployees(ownerAccountId?: number): Promise<Employee[]> {
    if (ownerAccountId) {
      return db.select().from(employees).where(eq(employees.ownerAccountId, ownerAccountId));
    }
    return db.select().from(employees);
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

  async getShift(id: number): Promise<Shift | undefined> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
    return shift;
  }

  async getShiftsByEmployee(employeeId: number): Promise<Shift[]> {
    return db.select().from(shifts).where(eq(shifts.employeeId, employeeId));
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
    const rows = await db.select().from(accounts).where(eq(accounts.role, "manager"));
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

  async createTimeEntry(employeeId: number, type: string, date: string): Promise<TimeEntry> {
    const [entry] = await db.insert(timeEntries).values({
      employeeId,
      type,
      date,
      timestamp: new Date(),
    }).returning();
    return entry;
  }

  async createTimeEntryManual(employeeId: number, type: string, date: string, timestamp: Date): Promise<TimeEntry> {
    const [entry] = await db.insert(timeEntries).values({
      employeeId,
      type,
      date,
      timestamp,
    }).returning();
    return entry;
  }

  async getTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<TimeEntry[]> {
    const result = await pool.query(
      "SELECT id, employee_id, type, timestamp, entry_date::text FROM time_entries WHERE employee_id = $1 AND entry_date = $2 ORDER BY timestamp",
      [employeeId, date]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      type: row.type,
      timestamp: row.timestamp,
      date: row.entry_date,
    }));
  }

  async getTimeEntriesByDate(date: string, ownerAccountId?: number): Promise<TimeEntry[]> {
    if (ownerAccountId) {
      const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
      if (empIds.length === 0) return [];
      const placeholders = empIds.map((_, i) => `$${i + 2}`).join(',');
      const result = await pool.query(
        `SELECT id, employee_id, type, timestamp, entry_date::text FROM time_entries WHERE entry_date = $1 AND employee_id IN (${placeholders}) ORDER BY timestamp`,
        [date, ...empIds]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        type: row.type,
        timestamp: row.timestamp,
        date: row.entry_date,
      }));
    }
    const result = await pool.query(
      "SELECT id, employee_id, type, timestamp, entry_date::text FROM time_entries WHERE entry_date = $1 ORDER BY timestamp",
      [date]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      type: row.type,
      timestamp: row.timestamp,
      date: row.entry_date,
    }));
  }

  async getAllTimeEntries(ownerAccountId?: number): Promise<TimeEntry[]> {
    if (ownerAccountId) {
      const empIds = await this.getEmployeeIdsByOwner(ownerAccountId);
      if (empIds.length === 0) return [];
      const placeholders = empIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(
        `SELECT id, employee_id, type, timestamp, entry_date::text FROM time_entries WHERE employee_id IN (${placeholders}) ORDER BY timestamp`,
        [...empIds]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        type: row.type,
        timestamp: row.timestamp,
        date: row.entry_date,
      }));
    }
    const result = await pool.query("SELECT id, employee_id, type, timestamp, entry_date::text FROM time_entries ORDER BY timestamp");
    return result.rows.map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      type: row.type,
      timestamp: row.timestamp,
      date: row.entry_date,
    }));
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

  async getAllFeedback(): Promise<(Feedback & { username: string; email: string | null })[]> {
    const res = await pool.query(
      `SELECT f.id, f.account_id, f.message, f.created_at, a.username, a.email
       FROM feedback f
       JOIN accounts a ON a.id = f.account_id
       ORDER BY f.created_at DESC`
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      accountId: r.account_id,
      message: r.message,
      createdAt: r.created_at,
      username: r.username,
      email: r.email,
    }));
  }
}

export const storage = new DatabaseStorage();
