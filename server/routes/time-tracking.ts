import type { Router } from "express";
import { format } from "date-fns";
import { isOpenSessionEntryType } from "@shared/timekeeping";
import type { TimeEntry } from "@shared/schema";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";
import { addSSEClient, broadcastEntryUpdate, removeSSEClient } from "../sse";
import { autoCloseStaleSession } from "./auto-close";
import { DATE_ONLY_RE, getDateRangeQuery, toDateOnly } from "./utils";
import { handleKioskAction } from "../services/time-tracking/kiosk-action-service";
import { importTimesheetCsv } from "../services/time-tracking/csv-import-service";

export function registerTimeTrackingRoutes(router: Router) {
  router.get("/api/steepin/employees", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const emps = await storage.getEmployees(ownerAccountId);
    res.json(emps.filter(e => e.status === "active" && !e.hiddenFromSteepin));
  });

  router.get("/api/steepin/entries/:employeeId", async (req, res) => {
    await autoCloseStaleSession(Number(req.params.employeeId));
    const todayStr = format(new Date(), "yyyy-MM-dd");
    let entries = await storage.getTimeEntriesByEmployeeAndDate(Number(req.params.employeeId), todayStr);
    const lastType = entries.length > 0 ? entries[entries.length - 1].type : null;
    if (!isOpenSessionEntryType(lastType)) {
      const openDate = await storage.getOpenSessionDate(Number(req.params.employeeId));
      if (openDate && openDate !== todayStr) {
        entries = await storage.getTimeEntriesByEmployeeAndDate(Number(req.params.employeeId), openDate);
      }
    }
    res.json(entries);
  });

  // Legacy check endpoint — replaced by SSE stream. Returns static response
  // to prevent old clients from hammering the database.
  router.get("/api/steepin/entries/:employeeId/check", (_req, res) => {
    res.json({ deprecated: true, useStream: true });
  });

  router.get("/api/steepin/entries/:employeeId/stream", (req, res) => {
    const employeeId = Number(req.params.employeeId);
    if (isNaN(employeeId)) {
      return res.status(400).json({ message: "Invalid employee ID" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ employeeId })}\n\n`);

    const client = addSSEClient(employeeId, res);

    req.on("close", () => {
      removeSSEClient(client);
    });
  });

  router.get("/api/steepin/open-sessions", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const entries = await storage.getOpenSessionEntries(ownerAccountId);
    res.json(entries);
  });

  router.get("/api/steepin/entries", requireAuth, async (req, res) => {
    const ownerAccountId = req.session.userId!;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const all = req.query.all === "true";
    const range = getDateRangeQuery(req);
    if (range && "error" in range) return res.status(400).json({ message: range.error });
    if (range) {
      const entries = await storage.getTimeEntriesByDateRange(ownerAccountId, range.from, range.to, employeeId);
      return res.json(entries);
    }
    if (employeeId && date) {
      const entries = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      return res.json(entries);
    } else if (date) {
      const entries = await storage.getTimeEntriesByDate(date, ownerAccountId);
      return res.json(entries);
    }

    if (!all) {
      return res.status(400).json({
        message: "Date range required. Use ?date=YYYY-MM-DD, ?from=YYYY-MM-DD&to=YYYY-MM-DD, or explicit ?all=true.",
      });
    }

    const account = await storage.getAccount(ownerAccountId);
    if (!account || (account.role !== "admin" && account.role !== "manager")) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const entries = await storage.getAllTimeEntries(ownerAccountId);
    res.json(entries);
  });

  router.post("/api/steepin/action", async (req, res) => {
    const actionResult = await handleKioskAction(req.body);
    res.status(actionResult.status).json(actionResult.body);
  });

  const broadcastEntriesChanged = (entries: TimeEntry[], type: string = "delete", accountId?: number) => {
    const employeeIds = new Set(entries.map(entry => entry.employeeId));
    for (const employeeId of employeeIds) {
      const entry = entries.find((item) => item.employeeId === employeeId);
      broadcastEntryUpdate(employeeId, {
        type,
        timestamp: new Date().toISOString(),
        source: "manager",
        accountId,
        date: entry ? toDateOnly(entry.date as string | Date) : undefined,
      });
    }
  };

  router.patch("/api/steepin/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }
    const updateData: any = { source: "manager" };
    if (req.body.timestamp) {
      const timestamp = new Date(req.body.timestamp);
      if (Number.isNaN(timestamp.getTime())) {
        return res.status(400).json({ message: "Invalid timestamp" });
      }
      updateData.timestamp = timestamp;
    }
    if (req.body.type) {
      updateData.type = req.body.type;
    }
    if (req.body.role !== undefined) {
      updateData.role = req.body.role;
    }
    if (req.body.notes !== undefined) {
      const note = typeof req.body.notes === "string" ? req.body.notes.trim() : "";
      updateData.notes = note || null;
    }
    if (req.body.isUnpaid !== undefined) {
      updateData.isUnpaid = Boolean(req.body.isUnpaid);
    }
    const entry = await storage.updateTimeEntry(id, updateData, req.session.userId!);
    if (!entry) {
      console.warn(`[PATCH /api/steepin/entries/${id}] No row matched. ownerAccountId=${req.session.userId}, body=${JSON.stringify(req.body)}`);
      return res.status(404).json({ message: "Entry not found" });
    }
    console.log(`[PATCH /api/steepin/entries/${id}] OK. ownerAccountId=${req.session.userId}, fields=${Object.keys(updateData).join(",")}, savedNotes=${JSON.stringify(entry.notes)}, savedSource=${entry.source}`);
    broadcastEntryUpdate(entry.employeeId, {
      type: entry.type,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
      source: "manager",
      accountId: req.session.userId!,
      date: toDateOnly(entry.date as string | Date),
    });
    res.json(entry);
  });

  router.post("/api/steepin/entries", requireRole("admin", "manager"), async (req, res) => {
    const { employeeId, type, date, timestamp, role, notes, isUnpaid } = req.body;
    const employeeIdNum = Number(employeeId);
    if (!Number.isFinite(employeeIdNum) || !type || typeof date !== "string" || !DATE_ONLY_RE.test(date)) {
      return res.status(400).json({ message: "Employee ID, type, and date are required" });
    }
    const entryTimestamp = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(entryTimestamp.getTime())) {
      return res.status(400).json({ message: "Invalid timestamp" });
    }
    const entry = await storage.createTimeEntryManualForOwner(
      req.session.userId!,
      employeeIdNum,
      type,
      date,
      entryTimestamp,
      role || null,
      typeof notes === "string" && notes.trim() ? notes.trim() : null,
      isUnpaid === true
    );
    if (!entry) return res.status(404).json({ message: "Employee not found" });
    broadcastEntryUpdate(employeeIdNum, {
      type: entry.type,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
      source: "manager",
      accountId: req.session.userId!,
      date,
    });
    res.status(201).json(entry);
  });

  router.delete("/api/steepin/entries", requireRole("admin", "manager"), async (req, res) => {
    const employeeId = Number(req.query.employeeId);
    const date = req.query.date as string;
    if (!Number.isFinite(employeeId) || typeof date !== "string" || !DATE_ONLY_RE.test(date)) {
      return res.status(400).json({ message: "Employee ID and date are required" });
    }
    const emp = await storage.getEmployee(employeeId);
    if (!emp || emp.ownerAccountId !== req.session.userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const deletedEntries = await storage.deleteTimeEntriesByEmployeeAndDateForOwner(employeeId, date, req.session.userId!);
    broadcastEntriesChanged(deletedEntries, "delete", req.session.userId!);
    res.status(204).send();
  });

  router.delete("/api/steepin/entries/:id", requireRole("admin", "manager"), async (req, res) => {
    const entryId = Number(req.params.id);
    if (!Number.isFinite(entryId)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }
    const deletedEntry = await storage.deleteTimeEntryForOwner(entryId, req.session.userId!);
    if (!deletedEntry) return res.status(404).json({ message: "Entry not found" });
    broadcastEntriesChanged([deletedEntry], "delete", req.session.userId!);
    res.status(204).send();
  });

  router.post("/api/steepin/entries/delete-batch", requireRole("admin", "manager"), async (req, res) => {
    const { ids, employeeId, date } = req.body;
    if (employeeId !== undefined && date !== undefined) {
      const employeeIdNum = Number(employeeId);
      const dateStr = String(date);
      if (!Number.isFinite(employeeIdNum) || !DATE_ONLY_RE.test(dateStr)) {
        return res.status(400).json({ message: "Employee ID and date are required" });
      }
      const ownerAccountId = req.session.userId!;
      const empIds = await storage.getEmployeeIdsByOwner(ownerAccountId);
      if (!empIds.includes(employeeIdNum)) {
        return res.status(403).json({ message: "Not authorized" });
      }
      const deletedEntries = await storage.deleteTimeEntriesByEmployeeAndDateForOwner(employeeIdNum, dateStr, ownerAccountId);
      broadcastEntriesChanged(deletedEntries, "delete", ownerAccountId);
      return res.status(204).send();
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No IDs provided" });
    }
    const numericIds = ids.map(Number);
    if (!numericIds.every(Number.isFinite)) {
      return res.status(400).json({ message: "Invalid entry IDs" });
    }
    const ownerAccountId = req.session.userId!;
    const deletedEntries = await storage.batchDeleteTimeEntriesByIds(numericIds, ownerAccountId);
    if (deletedEntries.length === 0) return res.status(404).json({ message: "Entries not found" });
    broadcastEntriesChanged(deletedEntries, "delete", ownerAccountId);
    res.status(204).send();
  });

  // === CSV IMPORT ===
  router.post("/api/timesheets/import-csv", requireRole("admin", "manager"), async (req, res) => {
    try {
      const importResult = await importTimesheetCsv(req.session.userId!, req.body);
      res.status(importResult.status).json(importResult.body);
    } catch (err: any) {
      console.error("CSV import error:", err);
      res.status(500).json({ message: err.message || "Import failed" });
    }
  });
}
