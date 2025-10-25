// components/LogoutButton.tsx
"use client";
import Link from "next/link";

export default function LogoutButton() {
  return (
    <Link href="/logout" className="sv-btn" style={{ minWidth: 160 }}>
      Logout
    </Link>
  );
}