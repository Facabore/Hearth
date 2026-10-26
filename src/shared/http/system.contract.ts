import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  /** HU-E8-02: optional for clients built before the database check. */
  db: z.literal("ok").optional(),
});
export const HealthUnavailableSchema = z.object({
  status: z.literal("unavailable"),
  db: z.literal("unreachable"),
});

export const healthPaths: ZodOpenApiPathsObject = {
  "/api/v1/health": {
    get: {
      operationId: "getHealth",
      summary: "Liveness and database check",
      responses: {
        "200": {
          description: "The process is up and PostgreSQL answers",
          content: { "application/json": { schema: HealthResponseSchema } },
        },
        "503": {
          description: "PostgreSQL does not answer",
          content: { "application/json": { schema: HealthUnavailableSchema } },
        },
      },
    },
  },
};

export const openApiPaths: ZodOpenApiPathsObject = {
  "/api/v1/openapi.json": {
    get: {
      operationId: "getOpenApiDocument",
      summary: "OpenAPI 3.1 document of this API",
      responses: { "200": { description: "The OpenAPI document" } },
    },
  },
};
