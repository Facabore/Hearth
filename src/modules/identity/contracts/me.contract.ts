import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";
import {
  DATE_FORMATS,
  LOCALES,
  LOCKABLE_FIELDS,
  MAX_FAVORITE_CURRENCIES,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  type ProfileView,
} from "../application";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string().describe("The person's own language."),
  /** HU-E1-14: the user's IANA time zone. */
  timezone: z.string().describe("The person's own IANA time zone."),
});

const NumberFormat = z.enum(NUMBER_FORMATS);
const TimeFormat = z.enum(TIME_FORMATS);
const DateFormat = z.enum(DATE_FORMATS);
const WeekStart = z.enum(WEEK_STARTS);
const Formats = z.object({
  numberFormat: NumberFormat,
  timeFormat: TimeFormat,
  dateFormat: DateFormat,
  weekStart: WeekStart,
});

/** HU-E1-15: the user, with the formats as stored (null follows the rule), as they apply, the rules' defaults and locks. */
export const ProfileResponseSchema = MeResponseSchema.extend({
  handle: z
    .string()
    .optional()
    .describe(
      "P339: the person's @usuario, in lower case and without the @; sent once they picked one, absent while they have none.",
    ),
  preferences: z.object({
    stored: z.object({
      numberFormat: NumberFormat.nullable(),
      timeFormat: TimeFormat.nullable(),
      dateFormat: DateFormat.nullable(),
      weekStart: WeekStart.nullable(),
    }),
    effective: Formats,
    defaults: Formats.extend({
      timezone: z
        .string()
        .describe(
          "The installation's IANA time zone (APP_TIMEZONE), what Reset stores; not the person's own.",
        ),
      locale: z
        .enum(LOCALES)
        .describe("The installation's language, what Reset stores; es until HU-E8-18 stores one."),
    }),
    locked: z.array(z.enum(LOCKABLE_FIELDS)),
    displayCurrency: z
      .string()
      .nullable()
      .optional()
      .describe(
        "D29 (MC4): the person's display currency, sent once they chose one; absent means their personal space's currency.",
      ),
    favoriteCurrencies: z
      .array(z.string())
      .optional()
      .describe(
        "P342: the person's favorite ISO 4217 currencies, in their order, sent once they chose some (an empty list is a choice); absent means their personal space's currency is the only favorite.",
      ),
  }),
});

/**
 * HU-E1-14, HU-E1-15: the profile fields a user changes. An omitted field is unchanged and `null` returns a format to
 * the installation rule; the zone's validity and the locks are the use case's.
 */
export const UpdateMeBodySchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  locale: z.enum(LOCALES).optional(),
  numberFormat: NumberFormat.nullable().optional(),
  timeFormat: TimeFormat.nullable().optional(),
  dateFormat: DateFormat.nullable().optional(),
  weekStart: WeekStart.nullable().optional(),
  /** D29 (MC4): the person's display currency as an ISO 4217 code; null returns to their personal space's currency. */
  displayCurrency: z.string().length(3).nullable().optional(),
  /** P339: the person's @usuario (3–20 of a–z, 0–9 and _, a leading @ and upper case accepted); null clears it. */
  handle: z.string().max(64).nullable().optional(),
  /**
   * P342: the person's whole list of favorite currencies, in their order (at most 20, ISO 4217 codes, any case); a
   * repeated code keeps its first place, and an unknown one is the use case's UnknownCurrency.
   */
  favoriteCurrencies: z.array(z.string().length(3)).max(MAX_FAVORITE_CURRENCIES).optional(),
});

/**
 * HU-E1-15: the profile as `GET` and `PATCH /api/v1/me` answer it. D29 (MC4): `displayCurrency` is sent only once the
 * person chose one, so a client that never asked for it receives exactly what it received before (additive only); so is
 * P339's `handle`, and P342's `favoriteCurrencies`.
 */
export const meDto = (view: ProfileView) => {
  const { displayCurrency, favoriteCurrencies, ...preferences } = view.preferences;
  return {
    ...view.user,
    ...(view.handle === null ? {} : { handle: view.handle }),
    preferences: {
      ...preferences,
      ...(displayCurrency === null ? {} : { displayCurrency }),
      ...(favoriteCurrencies === null ? {} : { favoriteCurrencies }),
    },
  };
};

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
const profile = (description: string) => ({
  description,
  content: { "application/json": { schema: ProfileResponseSchema } },
});

export const mePaths: ZodOpenApiPathsObject = {
  "/api/v1/me": {
    get: {
      operationId: "getMe",
      summary: "The signed-in user",
      security,
      responses: {
        "200": profile("Current user"),
        "401": { description: "Not signed in", content: problemContent },
      },
    },
    patch: {
      operationId: "updateMe",
      summary:
        "Change the signed-in user's time zone, language, formats, @usuario and favorite currencies (HU-E1-14, HU-E1-15, P339, P342)",
      security,
      requestBody: { content: { "application/json": { schema: UpdateMeBodySchema } } },
      responses: {
        "200": profile("The updated user"),
        "401": { description: "Not signed in", content: problemContent },
        "409": { description: "PreferenceLocked, HandleTaken", content: problemContent },
        "422": {
          description: "ValidationFailed, InvalidTimeZone, UnknownCurrency, InvalidHandle",
          content: problemContent,
        },
      },
    },
  },
};
