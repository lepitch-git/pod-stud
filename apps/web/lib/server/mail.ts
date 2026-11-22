import "server-only";
import { isProductionDeployment } from "./auth";

/**
 * Envoi des e-mails (lien de connexion, invitations).
 * Avec BREVO_API_KEY et MAIL_FROM (adresse d'expédition validée dans Brevo), l'e-mail part vraiment.
 * Sans eux, hors production, l'application affiche le lien à l'écran : « mode test ».
 */
export const mailConfigured = () => !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
export const testMode = () => !mailConfigured() && !isProductionDeployment();

export interface Mail {
  to: string;
  subject: string;
  text: string;
  link: string;
  button: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** Rend « envoye » si l'e-mail est parti, « test » si le lien doit être affiché, « erreur » sinon. */
export async function sendMail(m: Mail): Promise<"envoye" | "test" | "erreur"> {
  if (!mailConfigured()) return testMode() ? "test" : "erreur";
  const html = `<p>${esc(m.text).replace(/\n/g, "<br>")}</p><p><a href="${esc(m.link)}" style="display:inline-block;padding:10px 16px;background:#5b3cc4;color:#fff;border-radius:6px;text-decoration:none">${esc(m.button)}</a></p><p style="color:#666;font-size:13px">Ou copiez ce lien : ${esc(m.link)}</p>`;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY as string,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: process.env.MAIL_FROM, name: "Pod Stud" },
        to: [{ email: m.to }],
        subject: m.subject,
        htmlContent: html,
        textContent: `${m.text}\n\n${m.link}`,
      }),
    });
    return r.ok ? "envoye" : "erreur";
  } catch {
    return "erreur";
  }
}
