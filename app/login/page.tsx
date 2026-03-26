// app/login/page.tsx
import { Suspense } from "react";
import LoginForm from "./ui";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <p style={{ opacity: 0.5, fontSize: "0.9rem" }}>Wird geladen…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}