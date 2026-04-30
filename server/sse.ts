import type { Response } from "express";

interface SSEClient {
  res: Response;
  employeeId: number;
}

const clients = new Map<number, Set<SSEClient>>();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function cleanupEmptySet(employeeId: number) {
  const clientSet = clients.get(employeeId);
  if (clientSet && clientSet.size === 0) {
    clients.delete(employeeId);
  }
  if (clients.size === 0 && heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function ensureHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const [employeeId, clientSet] of clients) {
      const dead: SSEClient[] = [];
      for (const client of clientSet) {
        try {
          const data = JSON.stringify({ serverTime: new Date().toISOString() });
          client.res.write(`event: heartbeat\ndata: ${data}\n\n`);
        } catch {
          dead.push(client);
        }
      }
      for (const c of dead) {
        clientSet.delete(c);
      }
      if (clientSet.size === 0) {
        clients.delete(employeeId);
      }
    }
    if (clients.size === 0 && heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }, 30000);
}

export function addSSEClient(employeeId: number, res: Response): SSEClient {
  const client: SSEClient = { res, employeeId };
  if (!clients.has(employeeId)) {
    clients.set(employeeId, new Set());
  }
  clients.get(employeeId)!.add(client);
  ensureHeartbeat();
  return client;
}

export function removeSSEClient(client: SSEClient) {
  const clientSet = clients.get(client.employeeId);
  if (clientSet) {
    clientSet.delete(client);
    cleanupEmptySet(client.employeeId);
  }
}

export function broadcastEntryUpdate(employeeId: number, data: {
  type: string;
  timestamp: string;
  source?: string;
}) {
  const clientSet = clients.get(employeeId);
  if (!clientSet || clientSet.size === 0) return;

  const event = `event: entry-update\ndata: ${JSON.stringify({
    employeeId,
    ...data,
    serverTime: new Date().toISOString(),
  })}\n\n`;

  const dead: SSEClient[] = [];
  for (const client of clientSet) {
    try {
      client.res.write(event);
    } catch {
      dead.push(client);
    }
  }
  for (const c of dead) {
    clientSet.delete(c);
  }
  cleanupEmptySet(employeeId);
}

export function getConnectedCount(employeeId?: number): number {
  if (employeeId !== undefined) {
    return clients.get(employeeId)?.size ?? 0;
  }
  let total = 0;
  for (const [, s] of clients) total += s.size;
  return total;
}
