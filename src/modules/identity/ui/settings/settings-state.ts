import type { MeDto } from "@/shared/ui/api/dto";

/** HU-E9-13: the four formats a person may store (null follows the installation's rule). */
export type FormatField = "numberFormat" | "dateFormat" | "timeFormat" | "weekStart";
export type Preferences = MeDto["preferences"];
type Stored = Preferences["stored"];
export type FormatPatch = { [F in FormatField]?: Stored[F] };

const effectiveOf = (preferences: Preferences, stored: Stored, field: FormatField) =>
  preferences.locked.includes(field)
    ? preferences.defaults[field]
    : (stored[field] ?? preferences.defaults[field]);

const withStored = <F extends FormatField>(
  preferences: Preferences,
  field: F,
  value: Stored[F],
): Preferences => {
  const stored = { ...preferences.stored, [field]: value };
  return {
    ...preferences,
    stored,
    effective: { ...preferences.effective, [field]: effectiveOf(preferences, stored, field) },
  };
};

/** Ruling P137: choosing the rule's own value stores null, so the field keeps following the rule. */
export const choose = <F extends FormatField>(
  preferences: Preferences,
  field: F,
  value: NonNullable<Stored[F]>,
): { next: Preferences; patch: FormatPatch } => {
  const stored = (value === preferences.defaults[field] ? null : value) as Stored[F];
  return { next: withStored(preferences, field, stored), patch: { [field]: stored } };
};

/** Reset of a format sends null: the field follows the rule again. */
export const reset = (
  preferences: Preferences,
  field: FormatField,
): { next: Preferences; patch: FormatPatch } => ({
  next: withStored(preferences, field, null),
  patch: { [field]: null },
});

export const rowState = (preferences: Preferences, field: FormatField): "locked" | "default" | "custom" => {
  if (preferences.locked.includes(field)) return "locked";
  return preferences.stored[field] === null ? "default" : "custom";
};

export type RegionField = "timezone" | "locale";

/** Rulings P64 and P137: the zone and the language stay concrete; Reset sends the installation's value, never null. */
export const chooseRegion = (
  me: MeDto,
  field: RegionField,
  value: string,
): { next: MeDto; patch: Record<string, string> } => ({
  next: { ...me, [field]: value },
  patch: { [field]: value },
});

export const regionState = (me: MeDto, field: RegionField): "locked" | "default" | "custom" => {
  if (me.preferences.locked.includes(field)) return "locked";
  return me[field] === me.preferences.defaults[field] ? "default" : "custom";
};
