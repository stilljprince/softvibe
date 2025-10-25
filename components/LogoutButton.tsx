// components/LogoutButton.tsx
"use client";

import { signOut } from "next-auth/react";

export default function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="sv-btn sv-btn--primary"
      style={{ minWidth: 160 }}
      aria-label="Logout"
    >
      Logout
    </button>
  );
}