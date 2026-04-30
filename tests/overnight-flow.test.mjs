#!/usr/bin/env node
import pg from "pg";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";
const DB_URL =
  process.env.DEV_DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!DB_URL) {
  console.error("FATAL: no DEV_DATABASE_URL / NEON_DATABASE_URL / DATABASE_URL set");
  process.exit(2);
}

const pool = new pg.Pool({
  connectionString: DB_URL,
  ssl: DB_URL.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
});

const fmtDate = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const failures = [];
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures.push(msg);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

async function postAction(body) {
  const res = await fetch(`${BASE_URL}/api/steepin/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

async function setup() {
  console.log("Setup: preparing test account, employee, shift, settings...");

  // Pick a cutover midnight (UTC) that is well within the server's ±24h
  // offlineTimestamp drift window. Use the most recent UTC midnight if it is
  // at least 4h ago, otherwise use yesterday's.
  const now = new Date();
  let cutover = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  if (now.getTime() - cutover.getTime() < 4 * 3600 * 1000) {
    cutover = new Date(cutover.getTime() - 24 * 3600 * 1000);
  }
  const sessionDate = fmtDate(new Date(cutover.getTime() - 60 * 60 * 1000));
  console.log(`  cutover midnight (UTC) = ${cutover.toISOString()}`);
  console.log(`  session calendar date  = ${sessionDate} (UTC)`);

  // Account: reuse "overnight-test-admin" if present, else create.
  let accountId;
  const acc = await pool.query(
    "SELECT id FROM accounts WHERE username = 'overnight-test-admin' LIMIT 1"
  );
  if (acc.rows[0]) {
    accountId = acc.rows[0].id;
    await pool.query(
      "UPDATE accounts SET timezone = 'UTC', agency_name = 'OvernightTest' WHERE id = $1",
      [accountId]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO accounts (username, password, role, agency_name, timezone, email_verified)
       VALUES ('overnight-test-admin', 'not-a-real-hash', 'manager', 'OvernightTest', 'UTC', true)
       RETURNING id`
    );
    accountId = ins.rows[0].id;
  }

  // Notification settings live on the accounts row itself.
  await pool.query(
    `UPDATE accounts SET
       notify_late = true,
       notify_early_clock_out = true,
       notify_notes = true,
       notify_approvals = true,
       late_threshold_minutes = 15,
       early_clock_out_threshold_minutes = 15,
       timezone = 'UTC'
     WHERE id = $1`,
    [accountId]
  );

  // Employee: fresh one each run (ensures no pre-existing open session)
  const emp = await pool.query(
    `INSERT INTO employees (name, access_code, owner_account_id, hourly_rate)
     VALUES ('OvernightTest Employee', '9999', $1, 0)
     RETURNING id`,
    [accountId]
  );
  const employeeId = emp.rows[0].id;

  // Scheduled overnight shift: 23:00 - 02:00 on the session calendar date
  await pool.query(
    `INSERT INTO shifts (employee_id, date, start_time, end_time, role)
     VALUES ($1, $2, '23:00', '02:00', 'tester')`,
    [employeeId, sessionDate]
  );

  return { accountId, employeeId, cutover, sessionDate };
}

async function teardown({ accountId, employeeId }) {
  console.log("Teardown: removing employee, shift, entries, notifications...");
  await pool.query("DELETE FROM time_entries WHERE employee_id = $1", [employeeId]);
  await pool.query("DELETE FROM shifts WHERE employee_id = $1", [employeeId]);
  await pool.query("DELETE FROM employees WHERE id = $1", [employeeId]);
  // Wipe notifications generated during the test so re-runs are clean
  await pool.query(
    `DELETE FROM notifications WHERE account_id = $1 AND data::text LIKE '%' || $2 || '%'`,
    [accountId, `"employeeId":${employeeId}`]
  );
}

async function run() {
  const ctx = await setup();
  const { accountId, employeeId, cutover, sessionDate } = ctx;
  try {
    const t = (offsetMs) => new Date(cutover.getTime() + offsetMs).toISOString();

    // Times relative to UTC midnight cutover:
    //   T1 = cutover - 1h     → clock-in (= 23:00 UTC, exactly shift start, NOT late)
    //   T2 = cutover - 5min   → break-start
    //   T3 = cutover + 5min   → break-end (next calendar day)
    //   T4 = cutover + 2h     → clock-out (= 02:00 UTC, exactly shift end, NOT early)
    const steps = [
      { type: "clock-in",    ts: t(-60 * 60 * 1000),  label: "clock-in @ 23:00 UTC" },
      { type: "break-start", ts: t(-5 * 60 * 1000),   label: "break-start @ 23:55 UTC" },
      { type: "break-end",   ts: t( 5 * 60 * 1000),   label: "break-end @ 00:05 UTC (next day)" },
      { type: "clock-out",   ts: t(120 * 60 * 1000),  label: "clock-out @ 02:00 UTC (next day)" },
    ];

    console.log("\nTest 1: cross-midnight session must complete with no 409 conflicts");
    for (const step of steps) {
      const res = await postAction({
        employeeId,
        type: step.type,
        passcode: "9999",
        offlineTimestamp: step.ts,
      });
      if (res.status === 409) {
        fail(`${step.label} returned 409 (cross-midnight bug): ${JSON.stringify(res.body)}`);
      } else if (res.status >= 200 && res.status < 300) {
        pass(`${step.label} returned ${res.status}`);
      } else {
        fail(`${step.label} returned ${res.status}: ${JSON.stringify(res.body)}`);
      }
    }

    console.log("\nTest 2: clock-out entry_date matches the original clock-in's session date");
    const sessionRows = await pool.query(
      `SELECT type, entry_date, timestamp FROM time_entries
       WHERE employee_id = $1 ORDER BY timestamp ASC`,
      [employeeId]
    );
    const clockOut = sessionRows.rows.find((r) => r.type === "clock-out");
    if (!clockOut) {
      fail("No clock-out entry was created");
    } else {
      const got = fmtDate(new Date(clockOut.entry_date));
      if (got === sessionDate) {
        pass(`clock-out entry_date = ${got} (matches session date)`);
      } else {
        fail(`clock-out entry_date = ${got}, expected ${sessionDate} (session bleed across midnight)`);
      }
    }

    console.log("\nTest 3: no false late or early notifications were generated");
    const notif = await pool.query(
      `SELECT type, message FROM notifications
       WHERE account_id = $1 AND type IN ('employee-late', 'early-clock-out')
         AND data::text LIKE '%' || $2 || '%'`,
      [accountId, `"employeeId":${employeeId}`]
    );
    if (notif.rows.length === 0) {
      pass("no late/early notifications fired for an on-time cross-midnight shift");
    } else {
      for (const n of notif.rows) fail(`unexpected ${n.type}: ${n.message}`);
    }

    console.log("\nTest 4: re-attempting clock-out after the session is closed must 409");
    const dup = await postAction({
      employeeId,
      type: "clock-out",
      passcode: "9999",
      offlineTimestamp: t(125 * 60 * 1000),
    });
    if (dup.status === 409) {
      pass(`duplicate clock-out correctly rejected with 409`);
    } else {
      fail(`duplicate clock-out returned ${dup.status} instead of 409`);
    }

    console.log("\nTest 5: late & early alerts still fire when actually late/early across midnight");
    // Fresh employee for the second scenario
    const emp2 = await pool.query(
      `INSERT INTO employees (name, access_code, owner_account_id, hourly_rate)
       VALUES ('OvernightLate Employee', '9999', $1, 0) RETURNING id`,
      [accountId]
    );
    const emp2Id = emp2.rows[0].id;
    await pool.query(
      `INSERT INTO shifts (employee_id, date, start_time, end_time, role)
       VALUES ($1, $2, '23:00', '02:00', 'tester')`,
      [emp2Id, sessionDate]
    );
    try {
      // Clock in 30 minutes late (23:30 UTC), threshold is 15 → expect a late notification
      const inLate = await postAction({
        employeeId: emp2Id, type: "clock-in", passcode: "9999",
        offlineTimestamp: t(-30 * 60 * 1000),
      });
      if (inLate.status >= 200 && inLate.status < 300) pass("late clock-in accepted");
      else fail(`late clock-in returned ${inLate.status}: ${JSON.stringify(inLate.body)}`);

      // Clock out 30 minutes early (01:30 UTC, after midnight) → expect an early notification
      const outEarly = await postAction({
        employeeId: emp2Id, type: "clock-out", passcode: "9999",
        offlineTimestamp: t(90 * 60 * 1000),
      });
      if (outEarly.status >= 200 && outEarly.status < 300) pass("early cross-midnight clock-out accepted");
      else fail(`early clock-out returned ${outEarly.status}: ${JSON.stringify(outEarly.body)}`);

      const lateN = await pool.query(
        `SELECT type, message FROM notifications
         WHERE account_id = $1 AND data::text LIKE '%' || $2 || '%'`,
        [accountId, `"employeeId":${emp2Id}`]
      );
      const hasLate = lateN.rows.some((r) => r.type === "employee-late");
      const hasEarly = lateN.rows.some((r) => r.type === "early-clock-out");
      if (hasLate) pass("employee-late notification fired");
      else fail("expected an employee-late notification, none found");
      if (hasEarly) pass("early-clock-out notification fired (across midnight)");
      else fail("expected an early-clock-out notification, none found");
    } finally {
      await pool.query("DELETE FROM time_entries WHERE employee_id = $1", [emp2Id]);
      await pool.query("DELETE FROM shifts WHERE employee_id = $1", [emp2Id]);
      await pool.query("DELETE FROM employees WHERE id = $1", [emp2Id]);
      await pool.query(
        `DELETE FROM notifications WHERE account_id = $1 AND data::text LIKE '%' || $2 || '%'`,
        [accountId, `"employeeId":${emp2Id}`]
      );
    }
  } finally {
    await teardown(ctx);
  }

  await runNonUtcScenario({ accountId });
}

// Find the UTC instant whose Europe/Rome wall-clock matches the given local
// y/m/d/H/M. Tries both possible offsets (+1 / +2 for DST) and returns the
// one that round-trips correctly.
function utcForRomeWallClock(year, month, day, hour, minute) {
  for (const offset of [1, 2]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour - offset, minute, 0, 0));
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(candidate);
    const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    if (
      parseInt(m.year, 10) === year &&
      parseInt(m.month, 10) === month &&
      parseInt(m.day, 10) === day &&
      parseInt(m.hour, 10) === hour &&
      parseInt(m.minute, 10) === minute
    ) return candidate;
  }
  throw new Error(`Could not resolve Rome wall-clock ${year}-${month}-${day} ${hour}:${minute}`);
}

async function runNonUtcScenario({ accountId }) {
  console.log("\nTest 6: timezone-aware overnight flow with agency timezone = Europe/Rome");

  // Switch the test account into Europe/Rome so the server uses Rome local
  // wall-clock for late/early math.
  await pool.query("UPDATE accounts SET timezone = 'Europe/Rome' WHERE id = $1", [accountId]);

  // Compute "today" in Rome based on real current Rome time.
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const m = Object.fromEntries(nowParts.map((p) => [p.type, p.value]));
  const romeNowH = parseInt(m.hour, 10) * 60 + parseInt(m.minute, 10);

  // Choose a Rome-local cutover (midnight) that is within ±20h of "now" in Rome
  // so all generated offlineTimestamps stay inside the server's 24h drift window.
  // Use Rome's "today" midnight if Rome-now is between ~04:00 and ~22:00, else
  // shift to Rome's "yesterday" or "tomorrow" midnight.
  const baseY = parseInt(m.year, 10);
  const baseM = parseInt(m.month, 10);
  const baseD = parseInt(m.day, 10);
  let cutoverY = baseY, cutoverM = baseM, cutoverD = baseD;
  if (romeNowH < 4 * 60) {
    // After Rome midnight but close to it; use today's midnight (just past).
  } else if (romeNowH > 22 * 60) {
    // Right before Rome midnight; use tomorrow's midnight.
    const dt = new Date(Date.UTC(baseY, baseM - 1, baseD + 1));
    cutoverY = dt.getUTCFullYear(); cutoverM = dt.getUTCMonth() + 1; cutoverD = dt.getUTCDate();
  }
  // Otherwise we're mid-day Rome → using today's midnight means clock-in (~yesterday 23:00)
  // and clock-out (~today 02:00) are both well within ±24h.

  const yesterday = new Date(Date.UTC(cutoverY, cutoverM - 1, cutoverD - 1));
  const sessionDateRome = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;

  const tIn      = utcForRomeWallClock(yesterday.getUTCFullYear(), yesterday.getUTCMonth() + 1, yesterday.getUTCDate(), 23, 0);
  const tBrkIn   = utcForRomeWallClock(yesterday.getUTCFullYear(), yesterday.getUTCMonth() + 1, yesterday.getUTCDate(), 23, 55);
  const tBrkOut  = utcForRomeWallClock(cutoverY, cutoverM, cutoverD, 0, 5);
  const tOut     = utcForRomeWallClock(cutoverY, cutoverM, cutoverD, 2, 0);

  console.log(`  Rome session date         = ${sessionDateRome}`);
  console.log(`  Rome 23:00 (clock-in)     = ${tIn.toISOString()} UTC`);
  console.log(`  Rome 02:00 (clock-out)    = ${tOut.toISOString()} UTC`);

  // Sanity: drift check
  const driftHours = (Math.max(
    Math.abs(tIn.getTime() - Date.now()),
    Math.abs(tOut.getTime() - Date.now())
  )) / 3600 / 1000;
  if (driftHours > 23.5) {
    console.log(`  (skipping Rome scenario — current Rome time puts events ${driftHours.toFixed(1)}h from now, outside 24h drift window)`);
    return;
  }

  // On-time employee: should generate ZERO late/early notifications.
  const empOnTime = await pool.query(
    `INSERT INTO employees (name, access_code, owner_account_id, hourly_rate)
     VALUES ('Rome OnTime', '9999', $1, 0) RETURNING id`,
    [accountId]
  );
  const onTimeId = empOnTime.rows[0].id;
  await pool.query(
    `INSERT INTO shifts (employee_id, date, start_time, end_time, role)
     VALUES ($1, $2, '23:00', '02:00', 'tester')`,
    [onTimeId, sessionDateRome]
  );
  try {
    for (const [type, ts, label] of [
      ["clock-in", tIn, "Rome on-time clock-in (23:00 local)"],
      ["break-start", tBrkIn, "Rome break-start (23:55 local)"],
      ["break-end", tBrkOut, "Rome break-end (00:05 local, next day)"],
      ["clock-out", tOut, "Rome on-time clock-out (02:00 local, next day)"],
    ]) {
      const r = await postAction({ employeeId: onTimeId, type, passcode: "9999", offlineTimestamp: ts.toISOString() });
      if (r.status >= 200 && r.status < 300) pass(`${label} returned ${r.status}`);
      else fail(`${label} returned ${r.status}: ${JSON.stringify(r.body)}`);
    }
    const n = await pool.query(
      `SELECT type, message FROM notifications
       WHERE account_id = $1 AND data::text LIKE '%' || $2 || '%'`,
      [accountId, `"employeeId":${onTimeId}`]
    );
    if (n.rows.length === 0) pass("Rome on-time shift fired ZERO notifications (correct)");
    else for (const row of n.rows) fail(`Rome on-time shift unexpectedly fired ${row.type}: ${row.message}`);
  } finally {
    await pool.query("DELETE FROM time_entries WHERE employee_id = $1", [onTimeId]);
    await pool.query("DELETE FROM shifts WHERE employee_id = $1", [onTimeId]);
    await pool.query("DELETE FROM employees WHERE id = $1", [onTimeId]);
    await pool.query(
      `DELETE FROM notifications WHERE account_id = $1 AND data::text LIKE '%' || $2 || '%'`,
      [accountId, `"employeeId":${onTimeId}`]
    );
  }

  // Genuinely late + early Rome employee: should generate EXACTLY one of each.
  const tLateIn = utcForRomeWallClock(yesterday.getUTCFullYear(), yesterday.getUTCMonth() + 1, yesterday.getUTCDate(), 23, 30);
  const tEarlyOut = utcForRomeWallClock(cutoverY, cutoverM, cutoverD, 1, 30);

  const empBad = await pool.query(
    `INSERT INTO employees (name, access_code, owner_account_id, hourly_rate)
     VALUES ('Rome LateEarly', '9999', $1, 0) RETURNING id`,
    [accountId]
  );
  const badId = empBad.rows[0].id;
  await pool.query(
    `INSERT INTO shifts (employee_id, date, start_time, end_time, role)
     VALUES ($1, $2, '23:00', '02:00', 'tester')`,
    [badId, sessionDateRome]
  );
  try {
    for (const [type, ts, label] of [
      ["clock-in", tLateIn, "Rome late clock-in (23:30 local, 30min late)"],
      ["clock-out", tEarlyOut, "Rome early clock-out (01:30 local, 30min early)"],
    ]) {
      const r = await postAction({ employeeId: badId, type, passcode: "9999", offlineTimestamp: ts.toISOString() });
      if (r.status >= 200 && r.status < 300) pass(`${label} accepted (${r.status})`);
      else fail(`${label} returned ${r.status}: ${JSON.stringify(r.body)}`);
    }
    const n = await pool.query(
      `SELECT type FROM notifications
       WHERE account_id = $1 AND data::text LIKE '%' || $2 || '%'`,
      [accountId, `"employeeId":${badId}`]
    );
    const lateCount = n.rows.filter((r) => r.type === "employee-late").length;
    const earlyCount = n.rows.filter((r) => r.type === "early-clock-out").length;
    if (lateCount === 1) pass("Rome late clock-in fired EXACTLY 1 late notification");
    else fail(`Rome late clock-in: expected 1 late notification, got ${lateCount}`);
    if (earlyCount === 1) pass("Rome cross-midnight early clock-out fired EXACTLY 1 early notification");
    else fail(`Rome early clock-out: expected 1 early notification, got ${earlyCount}`);
  } finally {
    await pool.query("DELETE FROM time_entries WHERE employee_id = $1", [badId]);
    await pool.query("DELETE FROM shifts WHERE employee_id = $1", [badId]);
    await pool.query("DELETE FROM employees WHERE id = $1", [badId]);
    await pool.query(
      `DELETE FROM notifications WHERE account_id = $1 AND data::text LIKE '%' || $2 || '%'`,
      [accountId, `"employeeId":${badId}`]
    );
  }

  // Restore account timezone so subsequent runs start clean.
  await pool.query("UPDATE accounts SET timezone = 'UTC' WHERE id = $1", [accountId]);
}

(async () => {
  console.log(`Overnight clock-in/out integration test → ${BASE_URL}\n`);
  let exitCode = 0;
  try {
    await run();
  } catch (err) {
    console.error("FATAL:", err);
    exitCode = 2;
  } finally {
    await pool.end();
  }
  console.log("");
  if (failures.length === 0 && exitCode === 0) {
    console.log("RESULT: PASS — all overnight-flow assertions met");
  } else {
    console.log(`RESULT: FAIL — ${failures.length} assertion(s) failed`);
    exitCode = exitCode || 1;
  }
  process.exit(exitCode);
})();
