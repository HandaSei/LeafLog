import type { TimeEntry } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { toEntryDateString, toEntryTimestampIso } from "@/lib/timesheets/session-engine";

function normalizeEntryForCache(entry: TimeEntry): TimeEntry {
  return {
    ...entry,
    date: toEntryDateString(entry.date) as unknown as TimeEntry["date"],
    timestamp: toEntryTimestampIso(entry.timestamp) as unknown as TimeEntry["timestamp"],
  };
}

function sortEntriesForCache(list: TimeEntry[]) {
  return [...list].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function createTimesheetEntryCache(entriesFrom: string, entriesTo: string) {
  const invalidateVisibleEntries = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/steepin/entries", "range", entriesFrom, entriesTo],
      exact: true,
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/steepin/entries", "date", toEntryDateString(new Date())],
      exact: true,
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/steepin/open-sessions"],
      exact: true,
    });
  };

  const replaceEntryInCaches = (entry: TimeEntry) => {
    const normalized = normalizeEntryForCache(entry);
    const replace = (old: TimeEntry[] | undefined) => {
      if (!Array.isArray(old) || !old.some(e => e.id === normalized.id)) return old;
      return sortEntriesForCache(old.map(e => e.id === normalized.id ? { ...e, ...normalized } : e));
    };

    queryClient.setQueriesData<TimeEntry[]>({ queryKey: ["/api/steepin/entries"] }, replace);
    queryClient.setQueryData<TimeEntry[]>(["/api/steepin/open-sessions"], replace);
  };

  const upsertEntryInVisibleCaches = (entry: TimeEntry) => {
    const normalized = normalizeEntryForCache(entry);
    const entryDate = toEntryDateString(normalized.date);
    const upsert = (old: TimeEntry[] | undefined) => {
      if (!Array.isArray(old)) return old;
      const exists = old.some(e => e.id === normalized.id);
      const next = exists
        ? old.map(e => e.id === normalized.id ? { ...e, ...normalized } : e)
        : [...old, normalized];
      return sortEntriesForCache(next);
    };

    if (entryDate >= entriesFrom && entryDate <= entriesTo) {
      queryClient.setQueryData<TimeEntry[]>(["/api/steepin/entries", "range", entriesFrom, entriesTo], upsert);
    }
    queryClient.setQueryData<TimeEntry[]>(["/api/steepin/entries", "date", entryDate], upsert);
  };

  const removeEntriesFromCaches = (ids: number[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const remove = (old: TimeEntry[] | undefined) => {
      if (!Array.isArray(old) || !old.some(e => idSet.has(e.id))) return old;
      return old.filter(e => !idSet.has(e.id));
    };

    queryClient.setQueriesData<TimeEntry[]>({ queryKey: ["/api/steepin/entries"] }, remove);
    queryClient.setQueryData<TimeEntry[]>(["/api/steepin/open-sessions"], remove);
  };

  return {
    invalidateVisibleEntries,
    replaceEntryInCaches,
    upsertEntryInVisibleCaches,
    removeEntriesFromCaches,
  };
}
