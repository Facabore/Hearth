/**
 * Ruling P133: "now" for a server render. The e2e run fixes it with HEARTH_E2E_FIXED_NOW, the same variable that fixes
 * the API's clock (Task 10), so the screens and the API agree on "today"; otherwise the system clock.
 */
export const serverNow = (env: Record<string, string | undefined> = process.env): Date =>
  env.HEARTH_E2E_FIXED_NOW ? new Date(env.HEARTH_E2E_FIXED_NOW) : new Date();

/** Ruling P182: the installation's zone (`APP_TIMEZONE`), for dates shown to someone without a profile. */
export const serverZone = (env: Record<string, string | undefined> = process.env): string =>
  env.APP_TIMEZONE ?? "America/Bogota";
