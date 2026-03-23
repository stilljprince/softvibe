"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { PlayerProvider } from "./components/player-context";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <PlayerProvider>{children}</PlayerProvider>
    </SessionProvider>
  );
}
