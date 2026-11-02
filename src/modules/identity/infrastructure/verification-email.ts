/**
 * Issue #86: the message that confirms an account's address. It carries both languages, Spanish first, like the
 * invitation email (ADR 0007), and links to the SPA's /verify-email screen, which confirms the token through the API.
 */
export const verificationMessage = (url: string) => ({
  subject: "Confirma tu correo en Hearth · Confirm your email on Hearth",
  text: [
    "Hola:",
    "",
    "Abre este enlace para confirmar que este correo es tuyo. Así puedes aceptar las invitaciones que te envíen a él.",
    url,
    "",
    "El enlace vence en 7 días. Si no creaste una cuenta en Hearth, ignora este mensaje.",
    "",
    "—",
    "",
    "Hi,",
    "",
    "Open this link to confirm this email is yours, so you can accept the invitations sent to it.",
    url,
    "",
    "The link expires in 7 days. If you didn't create a Hearth account, ignore this message.",
    "",
  ].join("\n"),
});

/** The SPA screen the link opens; the URL carries only the token. */
export const verificationUrl = (baseURL: string, token: string): string => {
  const url = new URL("/verify-email", baseURL);
  url.searchParams.set("token", token);
  return url.toString();
};
