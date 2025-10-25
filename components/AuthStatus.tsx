"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useMemo } from "react";

const PATHS = {
  login: "/login",
  register: "/register",
  account: "/account",
  generate: "/generate",
  logoutCallback: "/",
};

export default function AuthStatus() {
  const { data, status } = useSession();

  const displayName = useMemo(() => {
    const n = data?.user?.name || data?.user?.email || "Gast";
    return n;
  }, [data?.user?.name, data?.user?.email]);

  const initials = useMemo(() => {
    const n = data?.user?.name ?? data?.user?.email ?? "";
    const parts = n.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0]?.toUpperCase() ?? n[0]?.toUpperCase() ?? "👤";
    const second = parts[1]?.[0]?.toUpperCase() ?? "";
    const letters = /[A-Za-zÄÖÜäöüß]/.test(first) ? (first + second) : "👤";
    return letters || "👤";
  }, [data?.user?.name, data?.user?.email]);

  const loggedIn = !!data?.user;

  if (status === "loading") {
    return (
      <div className="sv-bar">
        <span className="sv-skeleton" style={{ width: 96 }} />
        <span className="sv-skeleton" style={{ width: 120 }} />
      </div>
    );
  }

  return (
    <div className="sv-bar" data-logged-in={loggedIn ? "true" : "false"}>
      {loggedIn ? (
        <>
          {/* Username-Chip -> /account */}
          <Link href={PATHS.account} className="sv-chip" aria-label="Mein Konto öffnen">
            <span className="sv-avatar">{initials}</span>
            <span className="sv-username" title={displayName}>{displayName}</span>
          </Link>

          {/* Generieren (Primary) */}
          <Link href={PATHS.generate} className="sv-btn sv-btn--primary">
            Generieren
          </Link>

         {/*                                                                //Logout (mit Text)
          <button
            className="sv-btn"
            onClick={() => signOut({ callbackUrl: PATHS.logoutCallback })}
            type="button"
          >
            Logout
          </button>  */} 
        </>
      ) : (
        <>
          {/* Anmelden (Primary) */}
          <Link href={PATHS.login} className="sv-btn sv-btn--primary">
            Anmelden
          </Link>

          {/* Registrieren (statt „Generieren“) */}
          <Link href={PATHS.register} className="sv-btn">
            Registrieren
          </Link>
        </>
      )}
    </div>
  );
}
