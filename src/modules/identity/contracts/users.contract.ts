import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, problems, securedByUser } from "@/shared/http/contracts";

/** Ruling P339: someone found by their exact @usuario: the handle and the name, and nothing else. */
export const HandleHolderSchema = z.object({
  handle: z.string().meta({ description: "The @usuario, in lower case and without the @" }),
  displayName: z.string(),
});

const HandlePath = z.object({ handle: z.string() });

export const usersPaths: ZodOpenApiPathsObject = {
  "/api/v1/users/by-handle/{handle}": {
    get: {
      operationId: "findUserByHandle",
      summary: "Find someone by their exact @usuario (P339)",
      description:
        "Exact match ignoring case; a leading @ is ignored. There is no listing and no prefix search. An unknown or malformed handle, and the caller's own, all answer UserNotFound. Throttled per person.",
      ...securedByUser,
      requestParams: { path: HandlePath },
      responses: {
        "200": { description: "The person's handle and name", content: jsonContent(HandleHolderSchema) },
        ...problems({ "401": "Unauthenticated", "404": "UserNotFound", "429": "TooManyRequests" }),
      },
    },
  },
};
