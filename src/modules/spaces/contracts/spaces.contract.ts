import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";

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
};
