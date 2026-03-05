# LeafLog - Employee Shift Management

## Overview
LeafLog is a web-based employee shift management application designed for scheduling, tracking, and managing employee work shifts. It aims to streamline workforce management for businesses by providing tools for shift creation, employee scheduling, time tracking (SteepIn), and administrative oversight. The application features a multi-tenant architecture ensuring data isolation for each account, robust authentication with role-based access control, and a user-friendly interface. It's built to enhance operational efficiency, reduce scheduling conflicts, and provide clear insights into employee work patterns.

## User Preferences
- Always use 24-hour time format (HH:MM) throughout the entire application. Do not use 12-hour AM/PM format.
- Ensure styling adheres to the specified color scheme: sage green (`#8B9E8B`) as primary and warm tan (`#E8DCC4`) for backgrounds.
- Dialogs should not include "Cancel" buttons; rely solely on the "X" close button.
- I prefer clear and concise explanations.
- I appreciate a modular and organized codebase.
- I expect the agent to prioritize security and data integrity.
- I want iterative development with frequent, small updates.

## System Architecture
The application follows a client-server architecture. The frontend is built with React and TypeScript, leveraging Vite for tooling, TanStack Query for data fetching, Wouter for routing, and Shadcn UI with Tailwind CSS for styling. The backend is an Express.js REST API, managing session-based authentication and interacting with a PostgreSQL database via Drizzle ORM.

**Key Architectural Decisions:**
- **Frontend Framework**: React + TypeScript for a robust and scalable user interface.
- **Styling**: Tailwind CSS with a custom theme (sage green primary, warm tan backgrounds) for consistent and modern UI/UX.
- **Backend Framework**: Express.js for a flexible and performant API layer.
- **Database**: PostgreSQL hosted on Neon for reliability and scalability, with Drizzle ORM for type-safe database interactions.
- **Authentication**: Session-based authentication with bcrypt for password hashing and role-based access control (Admin, Manager, Employee).
- **Multi-tenancy**: Achieved by linking all tenant-specific data (employees, shifts, time entries) to an `ownerAccountId`, ensuring data isolation.
- **Time Format**: Strict adherence to 24-hour time format (HH:MM) across the application.
- **PWA Support**: Includes a manifest.json and service worker for installability and offline capabilities.
- **Mobile Responsiveness**: Designed with a mobile-first approach, featuring a responsive sidebar and a mobile bottom navigation.
- **Custom UI Components**: Development of custom time input (analog clock picker), date input (calendar picker), and CSV importer components.

**Feature Specifications:**
- **Dashboard**: Displays key metrics, upcoming schedules, and unscheduled employees.
- **Scheduling**: Weekly and monthly calendar views with color-coded shifts.
- **Employee Management**: CRUD operations for employees, including search and role filtering.
- **Time Tracking (SteepIn)**: Employee clock-in/out and break tracking with passcode authentication. Supports notes, re-clock detection, and gap-time classification.
- **Access Codes**: Generation of time-limited access codes for employee login and onboarding.
- **Custom Roles**: Managers can define unlimited custom roles with associated colors.
- **Timesheets**: Detailed timesheets derived from SteepIn entries, with manager approval workflow for gap-time classifications.
- **Notification System**: In-app notifications for late clock-ins, early clock-outs, notes, and approval requests, with customizable thresholds.
- **Timesheet Backup**: Manual and automatic backup system before CSV imports, with restore functionality.
- **Account Registration**: Two-step email verification process for manager account creation.
- **Password Recovery**: Email-based password reset flow.
- **Employee Account Upgrade**: Shadow employee accounts can be upgraded to permanent accounts via email verification.

## External Dependencies
- **PostgreSQL (Neon)**: Main database for all application data.
- **Resend API**: Used for sending transactional emails (email verification, password reset codes).
- **connect-pg-simple**: PostgreSQL session store for Express.js.
- **Vite**: Frontend build tool.
- **TanStack Query**: Data fetching and caching library for React.
- **Wouter**: React router.
- **Shadcn UI**: UI component library.
- **Tailwind CSS**: Utility-first CSS framework.
- **Drizzle ORM**: TypeScript ORM for PostgreSQL.
- **bcrypt**: For password hashing.
- **Capacitor**: Used for building native Android and iOS applications from the web codebase.