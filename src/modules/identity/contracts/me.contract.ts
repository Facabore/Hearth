import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string(),
  /** HU-E1-14: the user's IANA time zone. */
  timezone: z.string(),
});

/** HU-E1-14: the profile fields a user changes; validity of the zone is checked by the use case. */
export const UpdateMeBodySchema = z.object({ timezone: z.string().min(1).max(64).optional() });

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
const user = (description: string) => ({
  description,
  content: { "application/json": { schema: MeResponseSchema } },
});

export const mePaths: ZodOpenApiPathsObject = {
  "/api/v1/me": {
    get: {
      operationId: "getMe",
      summary: "The signed-in user",
      security,
      responses: {
        "200": user("Current user"),
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
