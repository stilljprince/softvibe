// app/components/EmptyState.tsx
type Props = {
  title: string;
  hint?: string;
  action?: { href: string; label: string };
};

export default function EmptyState({ title, hint, action }: Props) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-nav-bg)",
        borderRadius: 16,
        padding: 16,
        textAlign: "center",
      }}
    >
      <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>{title}</h3>
      {hint ? (
        <p style={{ margin: "8px 0 0", opacity: 0.7 }}>{hint}</p>
      ) : null}
      {action ? (
        <a
          href={action.href}
          style={{
            display: "inline-block",
            marginTop: 12,
            fontWeight: 700,
            textDecoration: "none",
            padding: "8px 12px",
            borderRadius: 10,
            background: "var(--color-accent)",
            color: "#fff",
            border: "1px solid var(--color-accent)",
          }}
        >
          {action.label}
        </a>
      ) : null}
    </div>
  );
}