import type { Response } from "express";

interface EmployeeSSEClient {
  res: Response;
  employeeId: number;
}

interface ManagerSSEClient {
  res: Response;
  accountId: number;
}

interface ManagerLiveUpdate {
  type: "entries-changed" | "shifts-changed" | "employees-changed";
  employeeId?: number;
  date?: string;
  entryType?: string;
  shiftId?: number;
  timestamp?: string;
  source?: string;
}

const clients = new Map<number, Set<EmployeeSSEClient>>();
const managerClients = new Map<number, Set<ManagerSSEClient>>();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function hasAnyClients() {
  return clients.size > 0 || managerClients.size > 0;
}

function cleanupEmptySet(employeeId: number) {
  const clientSet = clients.get(employeeId);
  if (clientSet && clientSet.size === 0) {
    clients.delete(employeeId);
  }
  if (!hasAnyClients() && heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function cleanupEmptyManagerSet(accountId: number) {
  const clientSet = managerClients.get(accountId);
  if (clientSet && clientSet.size === 0) {
    managerClients.delete(accountId);
  }
  if (!hasAnyClients() && heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function ensureHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const [employeeId, clientSet] of clients) {
      const dead: EmployeeSSEClient[] = [];
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
    for (const [accountId, clientSet] of managerClients) {
      const dead: ManagerSSEClient[] = [];
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
        managerClients.delete(accountId);
      }
    }
    if (!hasAnyClients() && heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }, 30000);
}

export function addSSEClient(employeeId: number, res: Response): EmployeeSSEClient {
  const client: EmployeeSSEClient = { res, employeeId };
  if (!clients.has(employeeId)) {
    clients.set(employeeId, new Set());
  }
  clients.get(employeeId)!.add(client);
  ensureHeartbeat();
  return client;
}

export function removeSSEClient(client: EmployeeSSEClient) {
  const clientSet = clients.get(client.employeeId);
  if (clientSet) {
    clientSet.delete(client);
    cleanupEmptySet(client.employeeId);
  }
}

export function addManagerSSEClient(accountId: number, res: Response): ManagerSSEClient {
  const client: ManagerSSEClient = { res, accountId };
  if (!managerClients.has(accountId)) {
    managerClients.set(accountId, new Set());
  }
  managerClients.get(accountId)!.add(client);
  ensureHeartbeat();
  return client;
}

export function removeManagerSSEClient(client: ManagerSSEClient) {
  const clientSet = managerClients.get(client.accountId);
  if (clientSet) {
    clientSet.delete(client);
    cleanupEmptyManagerSet(client.accountId);
  }
}

export function broadcastManagerUpdate(accountId: number, data: ManagerLiveUpdate) {
  const clientSet = managerClients.get(accountId);
  if (!clientSet || clientSet.size === 0) return;

  const event = `event: manager-update\ndata: ${JSON.stringify({
    ...data,
    serverTime: new Date().toISOString(),
  })}\n\n`;

  const dead: ManagerSSEClient[] = [];
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
  cleanupEmptyManagerSet(accountId);
}

export function broadcastEntryUpdate(employeeId: number, data: {
  type: string;
  timestamp: string;
  source?: string;
  accountId?: number;
  date?: string;
}) {
  const { accountId, date, ...employeeData } = data;
  if (accountId) {
    broadcastManagerUpdate(accountId, {
      type: "entries-changed",
      employeeId,
      date: date ?? data.timestamp.slice(0, 10),
      entryType: data.type,
      timestamp: data.timestamp,
      source: data.source,
    });
  }

  const clientSet = clients.get(employeeId);
  if (!clientSet || clientSet.size === 0) return;

  const event = `event: entry-update\ndata: ${JSON.stringify({
    employeeId,
    ...employeeData,
    serverTime: new Date().toISOString(),
  })}\n\n`;

  const dead: EmployeeSSEClient[] = [];
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
