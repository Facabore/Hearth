import type { Mailer } from "@/shared/infrastructure/email/smtp-mailer";
import type { EmailSender, InvitationEmail } from "../application/invitation-ports";

/**
 * Issue #85: the invitation email. Nobody has chosen a language for the invitee yet, so it carries both, Spanish first
 * (the installation's default language). The URL holds only the token (HU-E1-06).
 */
export const invitationMessage = ({ spaceName, url }: Pick<InvitationEmail, "spaceName" | "url">) => ({
  subject: `Te invitaron a ${spaceName} en Hearth · You're invited to ${spaceName} on Hearth`,
  text: [
    "Hola:",
    "",
    `Te invitaron a unirte a ${spaceName} en Hearth, un espacio compartido para registrar gastos, dividirlos y ver quién pagó por quién.`,
    "",
    "Abre este enlace para aceptar. Vence en 7 días.",
    url,
    "",
    "—",
    "",
    "Hi,",
    "",
    `You've been invited to join ${spaceName} on Hearth, a shared space to record expenses, split them and see who paid for whom.`,
    "",
    "Open this link to accept. It expires in 7 days.",
    url,
    "",
  ].join("\n"),
});

/** HU-E1-06 `EmailSender` over SMTP (ADR 0007): resolves false when the message did not go out, never rejects. */
export const mailedInvitations = (mailer: Mailer): EmailSender => ({
  send: (email) => mailer.send({ to: email.to, ...invitationMessage(email) }),
});
