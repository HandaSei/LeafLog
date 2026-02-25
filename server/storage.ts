import { eq, and, gt, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  employees, shifts, accounts, accessCodes, timeEntries,
  type Employee, type InsertEmployee,
  type Shift, type InsertShift,
  type Account, type InsertAccount,
  type AccessCode, type TimeEntry,
} from "@shared/schema";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
  getEmployeeIdsByOwner(ownerAccountId: number): Promise<number[]>;
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
}

export const storage = new DatabaseStorage();
