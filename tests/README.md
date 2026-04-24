# Integration tests

Self-contained Node integration tests that hit the running dev server.
They use direct DB access only for setup/teardown.

## Prerequisites

- The app must be running locally on port 5000 (`npm run dev`).
- One of `DEV_DATABASE_URL`, `NEON_DATABASE_URL`, or `DATABASE_URL` must be set
  to the same database the dev server is connected to.

## Running

### `tests/overnight-flow.test.mjs`

Verifies the cross-midnight SteepIn fix and the timezone-aware notification
math from Task #9. The test:

1. Creates a fresh test employee under the `overnight-test-admin` account
   (created on first run) with an overnight shift `23:00 → 02:00`.
2. Posts `clock-in`, `break-start`, `break-end`, `clock-out` to
   `/api/steepin/action` using `offlineTimestamp` to straddle UTC midnight.
3. Asserts:
   - No request returns `409 Conflict` (the cross-midnight bug).
   - The `clock-out` entry's `entry_date` matches the original clock-in's
     session date (no session "bleed" across midnight).
   - No false `employee-late` / `early-clock-out` notifications fire for
     an on-time shift.
   - A duplicate `clock-out` after the session is closed correctly returns
     `409`.
   - Late and early alerts DO fire for a separate employee whose clock
     events are genuinely late/early across the midnight cutover.
4. Cleans up all test rows it created (employees, shifts, entries,
   notifications). The shared `overnight-test-admin` account is reused
   across runs.

Run with:

```bash
node tests/overnight-flow.test.mjs
```

Override the server URL with `TEST_BASE_URL` if needed.

Exit code is `0` on pass, `1` on assertion failure, `2` on fatal error.
