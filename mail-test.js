import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config({ path: ".env.local" }); // <--- wichtig

async function main() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"SoftVibe Test" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject: "✅ Testmail von SoftVibe",
      text: "Hallo! Dies ist eine Testmail, die zeigt, dass dein Gmail App-Passwort funktioniert.",
    });

    console.log("📩 Test-Mail gesendet:", info.messageId);
  } catch (err) {
    console.error("❌ Fehler beim Senden:", err);
  }
}

main();
