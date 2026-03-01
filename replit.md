# LeafLog - Employee Shift Management

## Overview
A web-based employee shift management application for scheduling, tracking, and managing employee work shifts. Built with React + Express + PostgreSQL. Features multi-tenant architecture with account isolation, SteepIn kiosk for time tracking, and sage green/warm tan theme.

## Architecture
- **Frontend**: React + TypeScript, Vite, TanStack Query, Wouter routing, Shadcn UI, Tailwind CSS
- **Backend**: Express.js with REST API, express-session for auth
- **Database**: PostgreSQL with Drizzle ORM (Neon hosted)
- **Auth**: Session-based with bcrypt password hashing, role-based access control
- **Multi-tenancy**: Each account owns its employees/shifts/time entries via `ownerAccountId` on employees table
- **Styling**: Tailwind CSS with sage green (#8B9E8B) primary, warm tan (#E8DCC4) backgrounds
- **Time format**: 24-hour (HH:MM) throughout the entire app — never use 12-hour AM/PM

## ⚠️ CRITICAL: Database Rules — Read Before Touching Anything

### Which database is in use
- **`NEON_DATABASE_URL`** (environment secret) is the LIVE database used by **both development and production**.
- `DATABASE_URL` (Replit internal) is a fallback only — it is NOT the source of truth.
- The app connects via: `process.env.NEON_DATABASE_URL || process.env.DATABASE_URL` in both `server/storage.ts` and `server/auth.ts`.
- **NEVER delete or modify the `NEON_DATABASE_URL` secret.** Doing so will break the app in both dev and prod.

### Schema vs actual database
- `shared/schema.ts` defines the desired schema using Drizzle ORM.
- **There is NO automatic migration system.** Schema changes in `schema.ts` do NOT apply to the actual database automatically.
- To add a column or table: run a raw `ALTER TABLE` / `CREATE TABLE` SQL directly via `psql` against the Neon DB.
- **Neon direct connection** (for psql/pg_dump): `postgresql://neondb_owner:...@ep-solitary-bar-alfuza4t.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require`
- **Neon pooler connection** (for app runtime): `postgresql://neondb_owner:...@ep-solitary-bar-alfuza4t-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
- The actual passwords/credentials are in the `NEON_DATABASE_URL` secret — never hardcode them.

### Actual database schema (what really exists in the DB)
```
accounts: id, username, password, role, employee_id, agency_name, created_at, email, paid_break_minutes, max_break_minutes
employees: id, name, role, color, passcode, status, owner_account_id, is_active
shifts: id, employee_id, date, start_time, end_time, color, notes, role
access_codes: id, code, employee_id, created_by, created_at, expires_at, used
time_entries: id, employee_id, entry_date, clock_in, clock_out, break_start, break_end, status, role
custom_roles: id, account_id, name, color
feedback: id, account_id, message, created_at
session: (managed by connect-pg-simple for express-session)
```

### Session store
- Uses `connect-pg-simple` with **the direct (non-pooler) Neon connection** — NOT the pooler.
- Neon's PgBouncer pooler runs in transaction mode which is incompatible with session storage.
- The session store strips `-pooler` from the hostname automatically: `u.hostname.replace("-pooler.", ".")`.
- `createTableIfMissing: true` means the `session` table is created automatically if absent.

## ⚠️ CRITICAL: Server Config Rules

### trust proxy
- `app.set("trust proxy", 1)` is set in `server/index.ts` — this is REQUIRED for secure cookies to work behind Replit's reverse proxy in production. Do NOT remove it.

### Forbidden files — NEVER edit these
- `vite.config.ts` — already configured, do not touch
- `server/vite.ts` — already configured, do not touch
- `package.json` — do not edit scripts; use the package manager tool to add packages
- `drizzle.config.ts` — do not edit

## Project Structure
- `client/src/pages/` - Dashboard, Schedule, Timesheets, Employees, Login, SteepIn (kiosk), Settings
- `client/src/components/` - AppSidebar, ShiftFormDialog, EmployeeFormDialog, EmployeeAvatar, AccessCodeDialog, ThemeProvider/Toggle, TimeInput/TimeRangeInput (custom analog clock picker), DateInput (custom calendar picker), MobileNav
- `client/src/lib/auth.tsx` - AuthProvider context with login/logout/register hooks
- `client/src/lib/constants.ts` - Colors, departments, roles, utility functions
- `server/auth.ts` - Session setup, auth routes, SteepIn routes, access code generation
- `server/routes.ts` - REST API endpoints with role-based middleware and ownership filtering
- `server/storage.ts` - DatabaseStorage class with Drizzle ORM, multi-tenant queries
- `server/seed.ts` - Seeds the admin account (FanEcchyy) if no accounts exist
- `shared/schema.ts` - Drizzle schemas for employees, shifts, accounts, access_codes, time_entries
- `client/public/` - PWA icons (icon-192.png, icon-512.png, apple-touch-icon.png, favicon.png), manifest.json, sw.js

## Multi-Tenancy
- **ownerAccountId**: Column on `employees` table linking each employee to the account that created them
- **Data isolation**: All GET endpoints filter by `req.session.userId` (ownerAccountId)
- **Ownership checks**: CRUD operations verify the logged-in user owns the employee/shift before allowing changes
- **Shifts/Time entries**: Filtered indirectly by joining with employees owned by the account
- **Registration**: All new accounts are created as "manager" role with an agencyName

## Authentication System
- **Admin**: Special superuser role — `FanEcchyy` account (id=3, agencyName="LeafLog"). Sees Feedback Inbox in sidebar.
- **Manager**: Standard manager role. Can send feedback (max 3 per 24h) via sidebar button.
- **Registration**: Any user can create a manager account with username, password, and agency name
- **Employee**: Uses time-limited access codes generated by managers
- **Access codes**: Format `agencyname-employeename-random16hex`, valid 48 hours, new codes expire old ones
- **SteepIn**: Kiosk mode for clock-in/out and break tracking. Requires manager login to activate, then 4–6 digit employee passcode for actions.

## API Endpoints
### Auth (no auth required)
- `GET /api/auth/me` - Current session info
- `GET /api/auth/setup-required` - Check if any managers exist
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/register-manager` - Create new manager account (requires agencyName)
- `POST /api/auth/access-code` - Login with access code
- `POST /api/auth/logout` - Logout

### Protected (requires auth, filtered by ownerAccountId)
- `GET/POST /api/employees` - List/create employees (filtered by owner)
- `GET/PATCH/DELETE /api/employees/:id` - Get/update/delete employee (ownership verified)
- `GET/POST /api/shifts` - List/create shifts (filtered by owner's employees)
- `GET/PATCH/DELETE /api/shifts/:id` - Get/update/delete shift

### Access Codes (admin/manager only)
- `POST /api/access-codes/generate` - Generate new access code for employee
- `GET /api/access-codes/:employeeId` - Get code history for employee

### Break Policy (admin/manager only)
- `GET /api/settings/break-policy` - Get paid break minutes and max break minutes
- `PATCH /api/settings/break-policy` - Update break policy settings

### SteepIn/Kiosk
- `GET /api/kiosk/employees` - List active employees (filtered by session owner if logged in)
- `POST /api/kiosk/action` - Record clock-in/out/break-start/break-end (requires passcode)
- `GET /api/kiosk/entries/:employeeId` - Get today's time entries
- `GET /api/kiosk/entries` - Get time entries (filtered by owner)

## Key Features
- Dashboard with stats, today's/tomorrow's schedule, unscheduled employees
- Weekly and monthly calendar views with color-coded shifts
- Employee management with search, CRUD, role filters
- Shift assignment with employee selection, time/date, color coding
- Multi-tenant data isolation (each account sees only their own data)
- Timesheets with actual worked hours from kiosk clock-in/out entries
- Access code generation for employee onboarding
- SteepIn kiosk for clock-in/out and break tracking
- Settings page with custom role management (up to 6 roles per account)
- Dark/light theme toggle
- Responsive sidebar with mobile bottom nav
- TimeInput/TimeRangeInput components for compact time entry (24h format)
- PWA support with app icons, manifest.json and service worker

## Per-Shift & Per-Timesheet Roles
- **shifts.role**: Each shift stores its own role (TEXT column). Pre-filled from employee's current role on creation. Shift color derived from this role.
- **time_entries.role**: Each time entry can store a role override (TEXT column). Set on clock-in entry when adding missing timesheets. Editable in timesheet detail dialog.
- **Employee role change confirmation**: When editing an employee's role, a confirmation dialog asks whether to update all existing shifts to the new role via `POST /api/employees/:id/update-shift-roles`.

## Storage Layer Notes
- Time entry queries use raw SQL with `pool.query()` and `entry_date::text` cast (Drizzle had issues with date column)
- `pool` is exported from `storage.ts` for direct SQL access in raw queries
- Multi-tenant filtering uses `getEmployeeIdsByOwner()` helper to get employee IDs, then filters with `IN` clause
- When adding new Drizzle queries that select from `accounts`, be aware ALL columns in `schema.ts` must exist in the actual DB or the query will crash

## Styling Rules
- Primary color: sage green `#8B9E8B`
- Background: warm tan `#E8DCC4`
- Use Tailwind utility classes; dark mode via `dark:` variants
- Mobile-first layout; bottom nav for mobile, sidebar for desktop
- Dialog X close button: `h-5 w-5`, `bg-muted/20`, `border`, `shadow-sm`
- No Cancel buttons inside dialogs — use X button only
