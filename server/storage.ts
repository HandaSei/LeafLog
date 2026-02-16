import { eq, and, gt, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  employees, shifts, accounts, accessCodes, timeEntries,
  type Employee, type InsertEmployee,
  type Shift, type InsertShift,
  type Account, type InsertAccount,
  type AccessCode, type TimeEntry,
} from "@shared/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export interface IStorage {
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: number): Promise<Employee | undefined>;
  createEmployee(data: InsertEmployee): Promise<Employee>;
  updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined>;
  deleteEmployee(id: number): Promise<void>;

  getShifts(): Promise<Shift[]>;
  getShift(id: number): Promise<Shift | undefined>;
  getShiftsByEmployee(employeeId: number): Promise<Shift[]>;
  createShift(data: InsertShift): Promise<Shift>;
  updateShift(id: number, data: Partial<InsertShift>): Promise<Shift | undefined>;
  deleteShift(id: number): Promise<void>;

  getAccounts(): Promise<Account[]>;
  getAccount(id: number): Promise<Account | undefined>;
  getAccountByUsername(username: string): Promise<Account | undefined>;
  createAccount(data: InsertAccount): Promise<Account>;
  hasAnyManagers(): Promise<boolean>;

  createAccessCode(code: string, employeeId: number, createdBy: number, expiresAt: Date): Promise<AccessCode>;
  getAccessCodeByCode(code: string): Promise<AccessCode | undefined>;
  getAccessCodesByEmployee(employeeId: number): Promise<AccessCode[]>;
  markAccessCodeUsed(id: number): Promise<void>;
  expireAccessCodesForEmployee(employeeId: number): Promise<void>;

  createTimeEntry(employeeId: number, type: string, date: string): Promise<TimeEntry>;
  getTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<TimeEntry[]>;
  getTimeEntriesByDate(date: string): Promise<TimeEntry[]>;
}

export class DatabaseStorage implements IStorage {
  async getEmployees(): Promise<Employee[]> {
    return db.select().from(employees);
  }

  async getEmployee(id: number): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.id, id));
    return emp;
  }

  async createEmployee(data: InsertEmployee): Promise<Employee> {
    const [emp] = await db.insert(employees).values(data).returning();
    return emp;
  }

  async updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [emp] = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
    return emp;
  }

  async deleteEmployee(id: number): Promise<void> {
    await db.delete(employees).where(eq(employees.id, id));
  }

  async getShifts(): Promise<Shift[]> {
    return db.select().from(shifts);
  }

  async getShift(id: number): Promise<Shift | undefined> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
    return shift;
  }

  async getShiftsByEmployee(employeeId: number): Promise<Shift[]> {
    return db.select().from(shifts).where(eq(shifts.employeeId, employeeId));
  }

  async createShift(data: InsertShift): Promise<Shift> {
    const [shift] = await db.insert(shifts).values(data).returning();
    return shift;
  }

  async updateShift(id: number, data: Partial<InsertShift>): Promise<Shift | undefined> {
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

  async createAccount(data: InsertAccount): Promise<Account> {
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

  async getTimeEntriesByEmployeeAndDate(employeeId: number, date: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).where(
      and(eq(timeEntries.employeeId, employeeId), eq(timeEntries.date, date))
    ).orderBy(timeEntries.timestamp);
  }

  async getTimeEntriesByDate(date: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).where(eq(timeEntries.date, date)).orderBy(timeEntries.timestamp);
  }
}

export const storage = new DatabaseStorage();
