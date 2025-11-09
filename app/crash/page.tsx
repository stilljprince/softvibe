// app/crash/page.tsx
export const runtime = "nodejs";

export default function CrashPage() {
  // absichtlicher Fehler → triggert app/error.tsx
  throw new Error("Test-Crash");
}