import type { TimeEntry } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export type EntryCreateInput = {
  employeeId: number;
  type: string;
  date: string;
  timestamp: string;
  role?: string;
  notes?: string | null;
  isUnpaid?: boolean;
};

export type EntryUpdateInput = {
  id: number;
  timestamp?: string;
  role?: string;
  notes?: string | null;
  isUnpaid?: boolean;
};

export async function createEntryRequest(data: EntryCreateInput): Promise<TimeEntry> {
  const res = await apiRequest("POST", "/api/steepin/entries", data);
  return res.json();
}

export async function updateEntryRequest(data: EntryUpdateInput): Promise<TimeEntry> {
  const body: Record<string, unknown> = {};
  if (data.timestamp !== undefined) body.timestamp = data.timestamp;
  if (data.role !== undefined) body.role = data.role;
  if (data.notes !== undefined) body.notes = data.notes;
  if (data.isUnpaid !== undefined) body.isUnpaid = data.isUnpaid;
  const res = await apiRequest("PATCH", `/api/steepin/entries/${data.id}`, body);
  return res.json();
}

export async function deleteEntryRequest(id: number): Promise<number> {
  await apiRequest("DELETE", `/api/steepin/entries/${id}`);
  return id;
}

export async function deleteEntriesBatchRequest(ids: number[]): Promise<number[]> {
  await apiRequest("POST", "/api/steepin/entries/delete-batch", { ids });
  return ids;
}
