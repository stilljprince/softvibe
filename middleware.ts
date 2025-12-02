// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// sehr simpler Request-ID Generator (ohne externe deps)
function rid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const incoming = req.headers.get("x-request-id");
  const id = incoming && incoming.trim() !== "" ? incoming : rid();
  res.headers.set("x-request-id", id);
  return res;
}

// App Router: alles durchlassen; du kannst das später gezielter scopen
export const config = {
  matcher: ["/:path*"],
};