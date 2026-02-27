import { storage, pool } from "./storage";
import { format, addDays } from "date-fns";
import bcrypt from "bcryptjs";

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      account_id integer NOT NULL,
      message text NOT NULL,
      created_at timestamp DEFAULT now()
    )
  `);
  await pool.query(`
    UPDATE accounts SET role = 'admin'
    WHERE agency_name = 'LeafLog' AND role = 'manager'
  `);
}

const EMPLOYEE_DATA = [
  { name: "Sarah Chen", email: "sarah.chen@company.com", phone: "(555) 234-5678", role: "Manager", color: "#3B82F6" },
  { name: "Marcus Rivera", email: "marcus.r@company.com", phone: "(555) 345-6789", role: "Supervisor", color: "#10B981" },
  { name: "Emily Watson", email: "emily.w@company.com", phone: "(555) 456-7890", role: "Team Lead", color: "#8B5CF6" },
  { name: "James O'Brien", email: "james.ob@company.com", phone: "(555) 567-8901", role: "Staff", color: "#F59E0B" },
  { name: "Aisha Patel", email: "aisha.p@company.com", phone: "(555) 678-9012", role: "Staff", color: "#F43F5E" },
  { name: "David Kim", email: "david.kim@company.com", phone: "(555) 789-0123", role: "Part-time", color: "#06B6D4" },
  { name: "Lisa Thompson", email: "lisa.t@company.com", phone: "(555) 890-1234", role: "Staff", color: "#F97316" },
  { name: "Carlos Mendez", email: "carlos.m@company.com", phone: "(555) 901-2345", role: "Supervisor", color: "#6366F1" },
];

const SHIFT_TEMPLATES = [
  { title: "Morning Shift", startTime: "06:00", endTime: "14:00", color: "#3B82F6" },
  { title: "Afternoon Shift", startTime: "14:00", endTime: "22:00", color: "#10B981" },
  { title: "Evening Shift", startTime: "17:00", endTime: "23:00", color: "#8B5CF6" },
  { title: "Opening Shift", startTime: "07:00", endTime: "15:00", color: "#F59E0B" },
  { title: "Closing Shift", startTime: "16:00", endTime: "00:00", color: "#F43F5E" },
  { title: "Split Shift", startTime: "10:00", endTime: "18:00", color: "#06B6D4" },
];

export async function seedDatabase() {
  await runMigrations();

  const existingAdmin = await storage.getAccountByUsername("admin");
  if (!existingAdmin) {
    const adminPassword = await bcrypt.hash("admin123", 10);
    await storage.createAccount({
      username: "admin",
      password: adminPassword,
      role: "manager",
      agencyName: "ShiftFlow HQ",
    });
    console.log("Admin account created (username: admin, password: admin123)");
  }

  const existing = await storage.getEmployees();
  if (existing.length > 0) return;

  const adminAccount = await storage.getAccountByUsername("admin");
  const adminId = adminAccount?.id;

  console.log("Seeding database with sample data...");

  const createdEmployees = [];
  for (const empData of EMPLOYEE_DATA) {
    const emp = await storage.createEmployee({ ...empData, status: "active", ownerAccountId: adminId });
    createdEmployees.push(emp);
  }

  const today = new Date();
  const startDate = addDays(today, -3);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = format(addDays(startDate, dayOffset), "yyyy-MM-dd");
    const numShifts = 3 + Math.floor(Math.random() * 4);

    const shuffledEmps = [...createdEmployees].sort(() => Math.random() - 0.5);
    const shuffledTemplates = [...SHIFT_TEMPLATES].sort(() => Math.random() - 0.5);

    for (let i = 0; i < Math.min(numShifts, shuffledEmps.length); i++) {
      const template = shuffledTemplates[i % shuffledTemplates.length];
      const emp = shuffledEmps[i];
      const isPast = addDays(startDate, dayOffset) < today;

      await storage.createShift({
        employeeId: emp.id,
        date,
        startTime: template.startTime,
        endTime: template.endTime,
        status: isPast ? "completed" : "scheduled",
        notes: null,
        color: template.color,
      });
    }
  }

  console.log("Seed data inserted successfully.");
}
