// lib/error.ts
export type ErrData = { code: string | null; msg: string };

export function toErrData(e: unknown): ErrData {
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const code =
      typeof obj.code === "string" ? obj.code :
      typeof obj.code === "number" ? String(obj.code) :
      null;
    const msg = typeof obj.message === "string" ? obj.message : "unknown";
    return { code, msg };
  }
  return { code: null, msg: "unknown" };
}