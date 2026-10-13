import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, PeriodSchema, problemContent, problems, securedByUser } from "@/shared/http/contracts";

export const PeriodPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int().min(1).max(31) }),
  z.object({
    kind: z.literal("SEMI_MONTHLY"),
    day1: z.number().int().min(1).max(31),
    day2: z.number().int().min(1).max(31),
  }),
]);

export const SpaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["PERSONAL", "SHARED", "DIRECT"]),
  currency: z.string(),
  periodPolicy: PeriodPolicySchema,
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).nullable(),
});

export const ListSpacesResponseSchema = z.object({ items: z.array(SpaceSummarySchema) });

/** Request shape: any integer days, so the domain answers InvalidPeriodPolicy (HU-E1-03) instead of ValidationFailed. */
export const PeriodPolicyInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int() }),
  z.object({ kind: z.literal("SEMI_MONTHLY"), day1: z.number().int(), day2: z.number().int() }),
]);

export const UpdateSpaceBodySchema = z.object({
  name: z.string().max(200).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" })
    .optional(),
  periodPolicy: PeriodPolicyInputSchema.optional(),
});

export const ListPeriodsQuerySchema = z.object({
  from: z.iso.date().optional(),
  count: z.coerce.number().int().min(1).max(24).default(6),
});
export const ListPeriodsResponseSchema = z.object({ items: z.array(PeriodSchema) });

const SpacePath = z.object({ spaceId: z.string() });

export const spacesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces": {
    get: {
      operationId: "listMySpaces",
      summary: "Spaces the authenticated user belongs to",
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "The user's spaces",
          content: { "application/json": { schema: ListSpacesResponseSchema } },
        },
        "401": { description: "Unauthenticated", content: problemContent },
      },
    },
  },
  "/api/v1/spaces/{spaceId}": {
    get: {
      operationId: "getSpace",
      summary: "One space the user belongs to",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "The space", content: jsonContent(SpaceSummarySchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
    patch: {
      operationId: "updateSpaceSettings",
      summary: "Rename the space, change its currency (until money is recorded) or its period policy",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(UpdateSpaceBodySchema) },
      responses: {
        "200": { description: "The updated space", content: jsonContent(SpaceSummarySchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "SpaceCurrencyLocked",
          "422": "ValidationFailed, InvalidSpaceName, InvalidPeriodPolicy, UnknownCurrency",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/periods": {
    get: {
      operationId: "listSpacePeriods",
      summary:
        "Consecutive periods from a date (default today), with stored plan boundaries taking precedence",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListPeriodsQuerySchema },
      responses: {
        "200": { description: "Periods in order", content: jsonContent(ListPeriodsResponseSchema) },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "422": "ValidationFailed, InvalidDate",
        }),
      },
    },
  },
};
