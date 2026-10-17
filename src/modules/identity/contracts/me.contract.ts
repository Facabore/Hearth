import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";
import {
  DATE_FORMATS,
  LOCKABLE_FIELDS,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  type ProfileView,
} from "../application";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string(),
  /** HU-E1-14: the user's IANA time zone. */
  timezone: z.string(),
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
  preferences: z.object({
    stored: z.object({
      numberFormat: NumberFormat.nullable(),
      timeFormat: TimeFormat.nullable(),
      dateFormat: DateFormat.nullable(),
      weekStart: WeekStart.nullable(),
    }),
    effective: Formats,
    defaults: Formats,
    locked: z.array(z.enum(LOCKABLE_FIELDS)),
  }),
});

/** HU-E1-14: the profile fields a user changes; validity of the zone is checked by the use case. */
export const UpdateMeBodySchema = z.object({ timezone: z.string().min(1).max(64).optional() });

/** HU-E1-15: the profile as `GET /api/v1/me` answers it (and `PATCH` from Task 18b-2). */
export const meDto = (view: ProfileView) => ({ ...view.user, preferences: view.preferences });

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
const user = (description: string) => ({
  description,
  content: { "application/json": { schema: MeResponseSchema } },
});
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
      summary: "Change the signed-in user's time zone (HU-E1-14)",
      security,
      requestBody: { content: { "application/json": { schema: UpdateMeBodySchema } } },
      responses: {
        "200": user("The updated user"),
        "401": { description: "Not signed in", content: problemContent },
        "422": { description: "ValidationFailed, InvalidTimeZone", content: problemContent },
      },
    },
  },
};
