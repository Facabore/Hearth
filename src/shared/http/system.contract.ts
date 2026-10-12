import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";

export const HealthResponseSchema = z.object({ status: z.literal("ok") });

export const healthPaths: ZodOpenApiPathsObject = {
  "/api/v1/health": {
    get: {
      operationId: "getHealth",
      summary: "Liveness check",
      responses: {
        "200": {
          description: "The process is up",
          content: { "application/json": { schema: HealthResponseSchema } },
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
