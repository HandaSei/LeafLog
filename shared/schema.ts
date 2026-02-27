import { sql } from "drizzle-orm";
import { pgTable, text, integer, date, time, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const accounts = pgTable("accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  role: text("role").notNull().default("employee"),
  employeeId: integer("employee_id"),
  agencyName: text("agency_name"),
  paidBreakMinutes: integer("paid_break_minutes"),
  maxBreakMinutes: integer("max_break_minutes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const breakPolicySchema = z.object({
  paidBreakMinutes: z.coerce.number().int().min(0).max(480).nullable(),
  maxBreakMinutes: z.coerce.number().int().min(0).max(480).nullable(),
});

export const employees = pgTable("employees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role").default("Staff"),
  department: text("department"),
  color: text("color").notNull().default("#3B82F6"),
  status: text("status").notNull().default("active"),
  avatarInitials: text("avatar_initials"),
  accountId: integer("account_id"),
  ownerAccountId: integer("owner_account_id"),
  accessCode: text("access_code").notNull().default("0000"),
});

export const shifts = pgTable("shifts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  status: text("status").notNull().default("scheduled"),
  notes: text("notes"),
  color: text("color"),
  role: text("role"),
});

export const accessCodes = pgTable("access_codes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeEntries = pgTable("time_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  date: date("entry_date").notNull(),
});

export const customRoles = pgTable("custom_roles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#8B9E8B"),
  ownerAccountId: integer("owner_account_id").notNull(),
});

export const insertEmployeeSchema = createInsertSchema(employees, {
  name: z.string().min(1, "Full name is required"),
  email: z.string().email().optional().or(z.literal("")),
  role: z.string().optional(),
  department: z.string().optional(),
  accessCode: z.string().min(4, "Passcode must be 4–6 digits").max(6, "Passcode must be 4–6 digits").regex(/^[0-9]+$/, "Passcode must be numeric").optional(),
}).omit({ id: true });

export const insertShiftSchema = createInsertSchema(shifts, {
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  employeeId: z.coerce.number().min(1),
  role: z.string().optional(),
}).omit({ id: true });

export const insertAccountSchema = createInsertSchema(accounts, {
  username: z.string().min(3),
  password: z.string().min(6),
  role: z.string().min(1),
}).omit({ id: true, createdAt: true });

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const registerManagerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  agencyName: z.string().min(1, "Agency name is required"),
});

export const accessCodeLoginSchema = z.object({
  code: z.string().min(1, "Access code is required"),
});

export const registerAccountSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
  email: z.string().email("Valid email is required"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const feedback = pgTable("feedback", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCustomRoleSchema = createInsertSchema(customRoles).omit({ id: true });
export const insertFeedbackSchema = createInsertSchema(feedback).omit({ id: true, createdAt: true });
export type Feedback = typeof feedback.$inferSelect;

export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Shift = typeof shifts.$inferSelect;
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type AccessCode = typeof accessCodes.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type CustomRole = typeof customRoles.$inferSelect;
