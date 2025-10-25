"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";

export default function LogoutPage() {
  useEffect(() => {
    // Abmelden & zurück auf die Landingpage
    signOut({ callbackUrl: "/" });
  }, []);

  return (
    <main className="sv-auth">
      <section className="sv-auth__card" aria-live="polite">
        <h1 className="sv-auth__title">Abmelden…</h1>
        <p className="sv-help">Einen Moment bitte, du wirst abgemeldet.</p>
        <div className="sv-spinner" aria-hidden />
      </section>
    </main>
  );
}