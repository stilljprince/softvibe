// app/login/page.tsx
import { Suspense } from "react";
import LoginForm from "./ui";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="sv-auth">
          <div className="sv-auth__card">
            <p style={{ opacity: 0.6 }}>Login wird geladen…</p>
          </div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}