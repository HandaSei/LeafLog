# ShiftFlow - Employee Shift Management

## Overview
A web-based employee shift management application for scheduling, tracking, and managing employee work shifts. Built with React + Express + PostgreSQL.

## Architecture
- **Frontend**: React + TypeScript, Vite, TanStack Query, Wouter routing, Shadcn UI, Tailwind CSS
- **Backend**: Express.js with REST API
- **Database**: PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS with custom design tokens (primary blue #3B82F6, success green #10B981, accent purple #8B5CF6)

## Project Structure
- `client/src/pages/` - Dashboard, Schedule, Employees pages
- `client/src/components/` - AppSidebar, ShiftFormDialog, EmployeeFormDialog, EmployeeAvatar, ThemeProvider/Toggle
- `client/src/lib/constants.ts` - Colors, departments, roles, utility functions
- `server/routes.ts` - REST API endpoints for employees and shifts
- `server/storage.ts` - DatabaseStorage class with Drizzle ORM
- `server/seed.ts` - Seed data with 8 employees and ~70 shifts
- `shared/schema.ts` - Drizzle schemas for employees and shifts tables

## API Endpoints
- `GET/POST /api/employees` - List/create employees
- `GET/PATCH/DELETE /api/employees/:id` - Get/update/delete employee
- `GET/POST /api/shifts` - List/create shifts
- `GET/PATCH/DELETE /api/shifts/:id` - Get/update/delete shift

## Key Features
- Dashboard with stats, today's/tomorrow's schedule, unscheduled employees
- Weekly and monthly calendar views with color-coded shifts
- Employee management with search, CRUD, department/role filters
- Shift assignment with employee selection, time/date, color coding
- Dark/light theme toggle
- Responsive sidebar navigation
