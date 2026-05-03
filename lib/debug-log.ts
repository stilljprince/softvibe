// lib/debug-log.ts
type Level = "info" | "warn" | "error" | "debug";

export type DebugEntry = {
  ts: string;            // ISO Zeit
  level: Level;
  route: string;         // z.B. /api/jobs POST
  userId?: string | null;
  message: string;       // kurzer Titel
  data?: unknown;        // kleine strukturierte Zusatzdaten
  reqId?: string | null; // x-request-id falls vorhanden
};

const MAX = 500;
const buf: DebugEntry[] = [];

export function addDebugLog(entry: DebugEntry) {
  buf.push(entry);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

export function getDebugLogs(limit = 100): DebugEntry[] {
  const n = Math.max(0, Math.min(limit, MAX));
  return buf.slice(-n).reverse(); // neueste zuerst
}