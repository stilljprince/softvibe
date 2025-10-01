export function confirmationTemplate(name: string) {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border-radius: 12px; background: #fdfaf6; color: #111; line-height: 1.6;">
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="https://raw.githubusercontent.com/stilljprince/softvibe-assets/main/softvibe-logo-pastel.svg" 
           alt="SoftVibe Logo" style="width: 150px; margin-bottom: 10px;" />
    </div>

    <p style="font-size: 16px;">Hallo <strong>${name}</strong>,</p>

    <p style="font-size: 16px;">
      danke dir, dass du uns geschrieben hast! 🙏 Deine Nachricht ist sicher bei uns gelandet
      und wir schauen sie uns so schnell wie möglich an.
    </p>

    <p style="font-size: 16px;">
      Normalerweise melden wir uns innerhalb von 1–2 Werktagen zurück. In der Zwischenzeit kannst
      du dich gerne schon mal auf unserer Plattform umsehen und die ersten Features ausprobieren. 🎧
    </p>

    <p style="font-size: 16px;">
      Wir freuen uns wirklich über dein Interesse an <strong>SoftVibe</strong> und hoffen,
      dass du hier genau die Entspannung findest, die du suchst. Ob ASMR, Meditation oder eine gute
      Schlafgeschichte – wir sind für dich da. 🌙✨
    </p>

    <p style="font-size: 16px; margin-top: 20px;">
      Bis bald und viele entspannte Grüße,<br/>
      dein SoftVibe-Team 💜
    </p>

    <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;" />

    <p style="font-size: 12px; color: #555; text-align: center;">
      Diese E-Mail wurde automatisch von SoftVibe generiert.<br/>
      Bitte antworte nicht direkt auf diese Nachricht.
    </p>
  </div>
  `;
}

