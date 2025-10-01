import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { confirmationTemplate } from "@/lib/email/confirmationTemplate";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, message } = body;

    console.log("📩 Neue Nachricht:", { name, email, message });

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 1) Mail an dich (Admin)
    await transporter.sendMail({
      from: `"SoftVibe Kontakt" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject: `Neue Nachricht von ${name}`,
      text: `
Name: ${name}
E-Mail: ${email}

Nachricht:
${message}
      `,
    });

    // 2) Bestätigungsmail an den Nutzer mit Template
    await transporter.sendMail({
      from: `"SoftVibe" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Danke für deine Nachricht bei SoftVibe ✨",
      html: confirmationTemplate(name),
    });

    return NextResponse.json(
      { success: true, message: "Nachricht gesendet ✅" },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ Fehler beim Mailversand:", error);
    return NextResponse.json(
      { success: false, message: "Fehler beim Senden ❌" },
      { status: 500 }
    );
  }
}


