/** HU-E1-15: how numbers are written: 1.234.567,89, 1,234,567.89 or 1 234 567,89. */
export const NUMBER_FORMATS = ["DOT_COMMA", "COMMA_DOT", "SPACE_COMMA"] as const;
/** HU-E1-15: a 24-hour or a 12-hour clock. */
export const TIME_FORMATS = ["H24", "H12"] as const;
/** HU-E1-15: day-month-year, month-day-year or year-month-day. */
export const DATE_FORMATS = ["DMY", "MDY", "YMD"] as const;
/** HU-E1-15: the first day of the week. */
export const WEEK_STARTS = ["MONDAY", "SUNDAY"] as const;
/** HU-E1-15: the interface languages; a language never sets a format (D23). */
export const LOCALES = ["es", "en"] as const;

export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type WeekStart = (typeof WEEK_STARTS)[number];
export type Locale = (typeof LOCALES)[number];

/** The four formats as they apply. */
export interface FormatPreferences {
  readonly numberFormat: NumberFormat;
  readonly timeFormat: TimeFormat;
  readonly dateFormat: DateFormat;
  readonly weekStart: WeekStart;
}

/** The four formats as a person stored them; null follows the installation rule (ruling P64). */
export type StoredPreferences = { readonly [K in keyof FormatPreferences]: FormatPreferences[K] | null };

/** A person who stored no format. */
export const NO_PREFERENCES: StoredPreferences = {
  numberFormat: null,
  timeFormat: null,
  dateFormat: null,
  weekStart: null,
};

export const FORMAT_FIELDS = ["numberFormat", "timeFormat", "dateFormat", "weekStart"] as const;
export type FormatField = (typeof FORMAT_FIELDS)[number];

/** The person-level fields an installation may lock (HU-E8-18): the four formats, the time zone and the language. */
export const LOCKABLE_FIELDS = [...FORMAT_FIELDS, "timezone", "locale"] as const;
export type LockableField = (typeof LOCKABLE_FIELDS)[number];

/** HU-E1-15, HU-E8-18: the installation's defaults and the fields people may not change. */
export interface InstallationRules {
  readonly defaults: FormatPreferences;
  readonly locked: readonly LockableField[];
}

/** HU-E1-15: the rules until HU-E8-18 stores the installation's own: es-CO's formats, nothing locked. */
export const BUILT_IN_RULES: InstallationRules = {
  defaults: { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" },
  locked: [],
};

/** What a person asks to change: an omitted field is unchanged; a null format returns to the rule. */
export interface ProfileChange {
  readonly timezone?: string;
  readonly locale?: Locale;
  readonly numberFormat?: NumberFormat | null;
  readonly timeFormat?: TimeFormat | null;
  readonly dateFormat?: DateFormat | null;
  readonly weekStart?: WeekStart | null;
}

const effective = <K extends FormatField>(
  field: K,
  stored: StoredPreferences,
  rules: InstallationRules,
): FormatPreferences[K] =>
  rules.locked.includes(field) ? rules.defaults[field] : (stored[field] ?? rules.defaults[field]);

/** HU-E1-15: the rule when the field is locked, otherwise the stored value, otherwise the rule; never the language. */
export const effectivePreferences = (
  stored: StoredPreferences,
  rules: InstallationRules,
): FormatPreferences => ({
  numberFormat: effective("numberFormat", stored, rules),
  timeFormat: effective("timeFormat", stored, rules),
  dateFormat: effective("dateFormat", stored, rules),
  weekStart: effective("weekStart", stored, rules),
});

/** HU-E1-15: the locked fields a change names, even to clear them or to repeat their value (PreferenceLocked). */
export const lockedFieldsIn = (change: ProfileChange, rules: InstallationRules): LockableField[] =>
  LOCKABLE_FIELDS.filter((field) => change[field] !== undefined && rules.locked.includes(field));

/** HU-E1-15: the formats a change sets or clears, without the ones it leaves out. */
export const formatsIn = (change: ProfileChange): Partial<StoredPreferences> =>
  Object.fromEntries(
    FORMAT_FIELDS.filter((field) => change[field] !== undefined).map((field) => [field, change[field]]),
  ) as Partial<StoredPreferences>;
