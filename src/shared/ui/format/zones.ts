/** HU-E9-13: the browser's zone, as Settings offers it. */
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every IANA zone the runtime knows. */
export const allTimeZones = (): string[] => Intl.supportedValuesOf("timeZone");

/** "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export const zoneCity = (zone: string): string => (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");

/** The zone's offset at an instant, as "GMT-5" ("GMT" for UTC: ICU 78 and later write "GMT+0", older ones "GMT"). */
export const zoneOffset = (zone: string, at: Date): string => {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return !offset || offset === "GMT+0" ? "GMT" : offset;
};
