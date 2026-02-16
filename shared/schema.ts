import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, date, time } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const employees = pgTable("employees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: text("role").notNull(),
  department: text("department").notNull(),
  color: text("color").notNull().default("#3B82F6"),
  status: text("status").notNull().default("active"),
  avatarInitials: text("avatar_initials"),
});

export const shifts = pgTable("shifts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  status: text("status").notNull().default("scheduled"),
  notes: text("notes"),
  color: text("color"),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });
export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true }).extend({
  date: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  employeeId: z.coerce.number().min(1, "Employee is required"),
});

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Shift = typeof shifts.$inferSelect;
export type InsertShift = z.infer<typeof insertShiftSchema>;
