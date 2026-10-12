import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string(),
  timezone: z.string(),
});

export const mePaths: ZodOpenApiPathsObject = {
  "/api/v1/me": {
    get: {
      operationId: "getMe",
      summary: "The signed-in user",
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      responses: {
        "200": { description: "Current user", content: { "application/json": { schema: MeResponseSchema } } },
        "401": { description: "Not signed in", content: problemContent },
      },
    },
  },
};
