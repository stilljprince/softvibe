import nodemailer from "nodemailer";

let lastSent: number | null = null;

export async function POST(req: Request) {
  try {
    const now = Date.now();

    // 30 Sekunden Rate-Limit
    if (lastSent && now - lastSent < 30_000) {
      return new Response(
        JSON.stringify({ success: false, error: "Too many requests. Please wait a moment." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await req.json();
    const { name, email, message, honeypot } = data;

    // Honeypot → falls ausgefüllt → Bot
    if (honeypot && honeypot.trim() !== "") {
      return new Response(
        JSON.stringify({ success: false, error: "Spam detected" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Rate-Limit-Zeit speichern
    lastSent = now;

    // Mail-Transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Mail-Optionen
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `Neue Kontaktanfrage von ${name}`,
      text: `Name: ${name}\nE-Mail: ${email}\n\nNachricht:\n${message}`,
    };

    // Mail senden
    await transporter.sendMail(mailOptions);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("❌ Mail error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}


