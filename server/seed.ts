import { storage } from "./storage";
import { format, addDays } from "date-fns";

const EMPLOYEE_DATA = [
  { name: "Sarah Chen", email: "sarah.chen@company.com", phone: "(555) 234-5678", role: "Manager", department: "Management", color: "#3B82F6" },
  { name: "Marcus Rivera", email: "marcus.r@company.com", phone: "(555) 345-6789", role: "Supervisor", department: "Kitchen", color: "#10B981" },
  { name: "Emily Watson", email: "emily.w@company.com", phone: "(555) 456-7890", role: "Team Lead", department: "Front of House", color: "#8B5CF6" },
  { name: "James O'Brien", email: "james.ob@company.com", phone: "(555) 567-8901", role: "Staff", department: "Bar", color: "#F59E0B" },
  { name: "Aisha Patel", email: "aisha.p@company.com", phone: "(555) 678-9012", role: "Staff", department: "Front of House", color: "#F43F5E" },
  { name: "David Kim", email: "david.kim@company.com", phone: "(555) 789-0123", role: "Part-time", department: "Kitchen", color: "#06B6D4" },
  { name: "Lisa Thompson", email: "lisa.t@company.com", phone: "(555) 890-1234", role: "Staff", department: "Delivery", color: "#F97316" },
  { name: "Carlos Mendez", email: "carlos.m@company.com", phone: "(555) 901-2345", role: "Supervisor", department: "Kitchen", color: "#6366F1" },
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
  const existing = await storage.getEmployees();
  if (existing.length > 0) return;

  console.log("Seeding database with sample data...");

  const createdEmployees = [];
  for (const empData of EMPLOYEE_DATA) {
    const emp = await storage.createEmployee({ ...empData, status: "active" });
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
        title: template.title,
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
