import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

/** Utils */
const clean = (v: unknown) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
const nowYear = () => new Date().getFullYear();

/** Basis-URL für absolute Links (Bilder etc.) */
function getBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL!;
  return "http://localhost:3000";
}

/** E-Mail-Template (Logo per absolute URL, kein CID) */
function renderEmail(opts: {
  brand?: string;
  logoUrl?: string;               // absolute PNG-URL
  headline: string;
  subline?: string;
  introLong?: string[];
  rows?: Array<{ label: string; value: string }>;
  outro?: string;
  footerNote?: string;
}) {
  const {
    brand = "SoftVibe",
    logoUrl,
    headline,
    subline,
    introLong = [],
    rows = [],
    outro,
    footerNote,
  } = opts;

  const rowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="width:160px;padding:10px 0;color:#6b5f5f;font-size:13px;font-weight:600;vertical-align:top;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;">
          ${r.label}
        </td>
        <td style="padding:10px 0;color:#2f2a2a;font-size:14px;line-height:20px;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;">
          ${String(r.value).replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br/>")}
        </td>
      </tr>`
    )
    .join("");

  const introHtml = (introLong || [])
    .map(
      (p) => `
    <p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:#3a2f2f;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;">
      ${p}
    </p>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="x-apple-disable-message-reformatting">
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${brand}</title>
</head>
<body style="margin:0;padding:0;background:#f6f4f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f2;padding:28px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:92%;background:#ffffff;border-radius:20px;box-shadow:0 10px 26px rgba(0,0,0,0.07);overflow:hidden;">
          <!-- Header mit Logo -->
          <tr>
            <td style="padding:28px 28px 8px 28px;background:linear-gradient(180deg,#ffe9f3 0%, #fff 70%);">
              <div style="text-align:center;">
                ${
                  logoUrl
                    ? `<img src="${logoUrl}" alt="${brand} Logo" width="120" height="40" style="display:inline-block;vertical-align:middle;margin-bottom:10px;" />`
                    : ""
                }
              </div>
              <h1 style="margin:6px 0 0 0;font-size:22px;line-height:30px;text-align:center;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#2e2a2a;">
                ${brand}
              </h1>
              ${
                subline
                  ? `<p style="margin:4px 0 0 0;text-align:center;color:#6f6464;font-size:13px;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;">${subline}</p>`
                  : ""
              }
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:18px 28px 0 28px;background:#fff;">
              <h2 style="margin:0 0 8px 0;font-size:20px;line-height:28px;color:#2f2a2a;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;">
                ${headline}
              </h2>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding:8px 28px 6px 28px;background:#fff;">
              ${introHtml}
            </td>
          </tr>

          ${
            rows.length
              ? `
          <!-- Daten-Tabelle -->
          <tr>
            <td style="padding:4px 28px 10px 28px;background:#fff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                ${rowsHtml}
              </table>
            </td>
          </tr>`
              : ""
          }

          ${
            outro
              ? `
          <!-- Outro -->
          <tr>
            <td style="padding:6px 28px 18px 28px;background:#fff;">
              <p style="margin:0;font-size:14px;line-height:22px;color:#4a4242;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;">
                ${outro}
              </p>
            </td>
          </tr>`
              : ""
          }

          <!-- Fuß -->
          <tr>
            <td style="padding:16px 28px 24px 28px;background:#fff;">
              <hr style="border:none;border-top:1px solid #eee;margin:0 0 10px 0;">
              <p style="margin:0;color:#9a8f8f;font-size:12px;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;">
                ${footerNote ?? `© ${nowYear()} ${brand} · Diese E-Mail wurde automatisch generiert.`}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    // Body sicher parsen (ohne any)
    const json: unknown = await req.json().catch(() => ({}));
    if (json === null || typeof json !== "object") {
      return NextResponse.json({ success: false, error: "Ungültiger Request-Body." }, { status: 400 });
    }
    const obj = json as Record<string, unknown>;
    const name = clean(typeof obj.name === "string" ? obj.name : "");
    const email = clean(typeof obj.email === "string" ? obj.email : "");
    const message = typeof obj.message === "string" ? obj.message.trim() : "";

    if (!name || !email || !message) {
      return NextResponse.json({ success: false, error: "Bitte alle Felder korrekt ausfüllen." }, { status: 400 });
    }

    const BRAND = "SoftVibe";
    const baseUrl = getBaseUrl();

    // PNG aus /public + Cache-Buster (Gmail-Cache)
    const logoUrl = `${baseUrl}/softvibe-logo-email.png?v=1`;

    // SMTP Transport
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER || "smtp.gmail.com",
      port: Number(process.env.EMAIL_PORT || 587),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD,
      },
    });

    const FROM_NAME = process.env.EMAIL_FROM_NAME || BRAND;
    const FROM_ADDR = process.env.EMAIL_FROM || process.env.EMAIL_USER;

    /* ========== 1) ADMIN-Mail an dich ========== */
    const adminHtml = renderEmail({
      brand: BRAND,
      logoUrl,
      headline: "Neue Kontaktanfrage",
      subline: "Über das SoftVibe Kontaktformular",
      introLong: [
        "Du hast soeben eine neue Nachricht erhalten. Unten findest du alle Angaben des Absenders in strukturierter Form.",
      ],
      rows: [
        { label: "Name", value: name },
        { label: "E-Mail", value: email },
        { label: "Nachricht", value: message },
      ],
      outro: "Du kannst direkt auf diese E-Mail antworten, der Reply-To ist bereits korrekt gesetzt.",
    });

    await transporter.sendMail({
      from: { name: FROM_NAME, address: FROM_ADDR! },
      to: process.env.EMAIL_RECEIVER || FROM_ADDR,
      replyTo: email,
      subject: `Kontakt · ${name}`,
      text:
        `Neue Kontaktanfrage\n\n` +
        `Name: ${name}\nE-Mail: ${email}\n\nNachricht:\n${message}\n`,
      html: adminHtml,
    });

    /* ========== 2) Nutzer-Bestätigung (langer Text/Logo) ========== */
    const userIntro: string[] = [
      `Hallo <strong>${name}</strong>,`,
      `danke dir, dass du uns geschrieben hast! 🙏 Deine Nachricht ist sicher bei uns gelandet und wir schauen sie uns so schnell wie möglich an.`,
      `Normalerweise melden wir uns innerhalb von <strong>1–2 Werktagen</strong> zurück. In der Zwischenzeit kannst du dich gerne schon mal auf unserer Plattform umsehen und die ersten Features ausprobieren. 🎧`,
      `Wir freuen uns wirklich über dein Interesse an <strong>SoftVibe</strong> und hoffen, dass du hier genau die Entspannung findest, die du suchst. Ob ASMR, Meditation oder eine gute Schlafgeschichte – wir sind für dich da. 🌙✨`,
      `Bis bald und viele entspannte Grüße,<br/>dein SoftVibe-Team 💜`,
    ];

    const userHtml = renderEmail({
      brand: BRAND,
      logoUrl,
      headline: "Danke für deine Nachricht bei SoftVibe ✨",
      introLong: userIntro,
      footerNote:
        "Diese E-Mail wurde automatisch von SoftVibe generiert. Bitte antworte nicht direkt auf diese Nachricht.",
    });

    await transporter.sendMail({
      from: { name: FROM_NAME, address: FROM_ADDR! },
      to: email,
      subject: "Danke für deine Nachricht bei SoftVibe ✨",
      text:
        `Hallo ${name},\n\n` +
        `danke dir, dass du uns geschrieben hast! Deine Nachricht ist sicher bei uns gelandet und wir schauen sie uns so schnell wie möglich an.\n\n` +
        `Normalerweise melden wir uns innerhalb von 1–2 Werktagen zurück. In der Zwischenzeit kannst du dich gerne schon mal auf unserer Plattform umsehen und die ersten Features ausprobieren.\n\n` +
        `Wir freuen uns wirklich über dein Interesse an SoftVibe und hoffen, dass du hier genau die Entspannung findest, die du suchst. Ob ASMR, Meditation oder eine gute Schlafgeschichte – wir sind für dich da.\n\n` +
        `Bis bald und viele entspannte Grüße,\n` +
        `dein SoftVibe-Team\n`,
      html: userHtml,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Contact route error:", err);
    return NextResponse.json(
      { success: false, error: "Senden fehlgeschlagen. Bitte später erneut versuchen." },
      { status: 500 }
    );
  }
}


