// lib/log.ts
export function getReqIdFromHeaders(h: Headers): string | null {
  return h.get("x-request-id");
}

type Level = "info" | "warn" | "error";

function baseLog(level: Level, reqId: string | null, msg: string, extra?: unknown) {
  const prefix = reqId ? `[rid:${reqId}]` : "[rid:-]";
  // In Vercel erscheint das als eine Log-Zeile
  if (extra !== undefined) {
     
    console[level](`${prefix} ${msg}`, extra);
  } else {
     
    console[level](`${prefix} ${msg}`);
  }
}

export const log = {
  info: (reqHeaders: Headers, msg: string, extra?: unknown) =>
    baseLog("info", getReqIdFromHeaders(reqHeaders), msg, extra),
  warn: (reqHeaders: Headers, msg: string, extra?: unknown) =>
    baseLog("warn", getReqIdFromHeaders(reqHeaders), msg, extra),
  error: (reqHeaders: Headers, msg: string, extra?: unknown) =>
    baseLog("error", getReqIdFromHeaders(reqHeaders), msg, extra),
};