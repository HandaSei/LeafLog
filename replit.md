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
- **PWA Support**: Includes a manifest.json and service worker (v20) for installability and offline capabilities. Service worker uses network-first strategy for navigation requests (cache fallback offline) and stale-while-revalidate for hashed assets. Pre-caches critical SteepIn images (including dark mode variants) during install. HTML shell conditionally renders SteepIn skeleton or generic spinner based on cached auth mode, and adapts skeleton colors to dark/light theme. SW explicitly skips Capacitor interceptor URLs (`_capacitor_*`, `_cap_*`) and wraps all `response.clone()` in try-catch for CapacitorHttp compatibility.
- **Mobile Responsiveness**: Designed with a mobile-first approach, featuring a responsive sidebar and a mobile bottom navigation.
- **Custom UI Components**: Development of custom time input (analog clock picker), date input (calendar picker), and CSV importer components.

**Feature Specifications:**
- **Dashboard**: Displays key metrics, upcoming schedules, and unscheduled employees.
- **Scheduling**: Weekly and monthly calendar views with color-coded shifts.
- **Employee Management**: CRUD operations for employees, including search and role filtering.
- **Time Tracking (SteepIn)**: Employee clock-in/out and break tracking with passcode authentication. Supports notes, re-clock detection, and gap-time classification. Entries have a `source` field ('employee' or 'manager') to track origin. The employee's "Current Shift" view stops at clock-out (no orphaned entries shown). A "Live Manager Edits" tab appears during active shifts showing only manager-created entries in real time. **Offline-first action queuing**: when the device loses connectivity, actions (clock-in/out, break-start/end) are validated locally via cached PIN and queued in localStorage (`leaflog_pending_actions`). Queued actions are synced automatically when the device comes back online. An amber "Offline" badge or blue "Syncing N" badge appears in the SteepIn header. Entries are also cached per-employee in localStorage (`leaflog_steepin_entries_cache`) so the employee's status renders without network access. **Cross-device real-time sync via SSE**: instead of polling, devices subscribe to `GET /api/steepin/entries/:employeeId/stream` (Server-Sent Events). The server broadcasts `entry-update` events whenever an entry is created, updated, or deleted (from any endpoint: steepin action, manager PATCH/POST/DELETE). The client `useEntriesSync` hook in `client/src/hooks/use-entries-sync.ts` opens an EventSource connection, auto-reconnects with exponential backoff (2s→30s), pauses when offline, and shows a static green "Live" badge when connected. Server SSE manager lives in `server/sse.ts` with heartbeats every 30s.
- **Access Codes**: Generation of time-limited access codes for employee login and onboarding.
- **Custom Roles**: Managers can define unlimited custom roles with associated colors.
- **Timesheets**: Detailed timesheets derived from SteepIn entries, with manager approval workflow for gap-time classifications. Timestamps are floored to the minute for consistent calculations matching the displayed HH:mm format. Unfinished breaks (break-start with no break-end) are treated as worked time. Delete timesheet always removes all entries for employee+date to clean up orphaned data. Cross-midnight shifts are normalized: `normalizeEntryDates()` reassigns orphaned entries (entries on a date without a preceding clock-in) back to the session's clock-in date, so a shift spanning midnight displays as one continuous entry under the clock-in date. Server-side `getOpenSessionDate` uses a 48-hour lookback window to find open sessions.
- **Notification System**: In-app notifications for late clock-ins, early clock-outs, notes, and approval requests, with customizable thresholds.
- **Timesheet Backup**: Manual and automatic backup system before CSV imports, with restore functionality.
- **PDF Export**: Timesheets and Schedule pages both have PDF export with employee selection, date range, and detailed tables with summaries. Uses jspdf + jspdf-autotable.
- **Admin Panel**: Admin-only page at `/admin` showing all accounts with search, sort, and role badges.
- **Employee Pay System**: Per-employee pay configuration with base hourly rate, tiered pay (weekly hour threshold with "Threshold Only" mode where only post-threshold hours are billed at Secondary Rate), special day rates (e.g. Sunday premium), and custom date rates. Pay fields stored in `employees` table as `hourly_rate`, `tier_enabled`, `tier_hours_threshold`, `tier_overtime_rate`, `tier_threshold_only`, `special_day_enabled`, `special_day_of_week`, `special_day_rate`, `custom_pay_days` (JSON). Pay calculations displayed in schedule day view and timesheets footer. Pay config accessible via employee card dropdown "Pay Settings". Dialog labels: "Tiered Pay" (not "Overtime"), "Secondary Rate" (not "Overtime rate"). Threshold Only mode: when active, base hourly rate is disabled; only hours after the weekly threshold are billed at the Secondary Rate; Special Day and Custom Date rates still apply within post-threshold hours. A warning alert explains this behavior to the manager.
- **Location Management**: Managers can lock specific devices to SteepIn mode from the Settings page. When a device enters SteepIn mode it registers itself (using a UUID stored in localStorage). Managers see all registered devices in Settings → Management → Location Management and can lock/unlock them, rename them, or remove them. A locked device hides the Exit button in SteepIn mode — the only way to exit is to unlock it from the manager account on another device. The device checks its lock status every 30 seconds. Data stored in `kiosk_devices` table. Theme controls (light/dark/auto-schedule) are also in Location Management, stored in accounts table (`steepin_theme_mode`, `steepin_day_start_hour`, `steepin_night_start_hour`). Theme settings cached in localStorage (`leaflog_steepin_theme`) for offline access.
- **SteepIn Dark Mode**: Full dark theme for the kiosk interface with dark background images (`steepin-bg-dark.webp`, `employee-card-bg-dark.webp`), themed employee cards, pin pad, dialogs, shift panels, and all UI elements. Auto-schedule mode checks local device time against configurable day/night hours. Theme colors defined in THEME_COLORS constant. First-time device guidance dialog shows tips about device locking, theme settings, and offline support.
- **Country Field**: Optional country field in manager registration, stored in `accounts.country`.
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