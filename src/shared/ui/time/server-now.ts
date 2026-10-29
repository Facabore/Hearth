/** Ruling P182: the installation's zone (`APP_TIMEZONE`), for dates shown to someone without a profile. */
export const serverZone = (env: Record<string, string | undefined> = process.env): string =>
  env.APP_TIMEZONE ?? "America/Bogota";
