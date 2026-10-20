import type { MeDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";

/** Pesos as the wire carries them: minor units in a string (string arithmetic is safe for test amounts). */
export const cop = (pesos: number): MoneyDto => ({ amount: String(pesos * 100), currency: "COP" });

const RULES = {
  numberFormat: "DOT_COMMA",
  timeFormat: "H24",
  dateFormat: "DMY",
  weekStart: "MONDAY",
} as const;

/** Ana, signed in, following every installation rule. */
export const meDto = (overrides: Partial<MeDto> = {}): MeDto => ({
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
  preferences: {
    stored: { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null },
    effective: { ...RULES },
    defaults: { ...RULES, timezone: "America/Bogota", locale: "es" },
    locked: [],
  },
  ...overrides,
});

/** Ana's personal space. */
export const spaceDto = (overrides: Partial<SpaceDto> = {}): SpaceDto => ({
  id: "sp-personal",
  name: "Personal",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: "OWNER",
  ...overrides,
});
