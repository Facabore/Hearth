import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, problems, securedByUser } from "@/shared/http/contracts";
import type { FriendRequestView, SentFriendRequest } from "../application";

/** Ruling P339: a friend request as its viewer sees it, named by the other person. */
export const FriendRequestSchema = z.object({
  id: z.string(),
  handle: z
    .string()
    .nullable()
    .meta({ description: "The other person's @usuario; null when they have none any more" }),
  displayName: z.string(),
  createdAt: z.iso.datetime(),
});

export const FriendRequestsSchema = z.object({
  incoming: z
    .array(FriendRequestSchema)
    .meta({ description: "Pending requests to the viewer, newest first" }),
  outgoing: z.array(FriendRequestSchema).meta({
    description:
      "Requests the viewer sent that were not accepted, newest first; a rejection is never told (S4)",
  }),
});

export const SendFriendRequestBodySchema = z.object({
  handle: z
    .string()
    .max(64)
    .meta({ description: "The exact @usuario; a leading @ and upper case are accepted" }),
});

export const SentFriendRequestSchema = FriendRequestSchema.extend({
  status: z.enum(["PENDING", "ACCEPTED"]).meta({
    description:
      "PENDING: the viewer's request, new (201) or already open (200). ACCEPTED: the other person had asked the viewer, and sending accepted it (200)",
  }),
  spaceId: z.string().optional().meta({ description: "The pair's direct space, when ACCEPTED" }),
});

const viewDto = (view: FriendRequestView): z.infer<typeof FriendRequestSchema> => ({
  id: view.id,
  handle: view.handle,
  displayName: view.displayName,
  createdAt: view.createdAt.toISOString(),
});

export const friendRequestsDto = (lists: {
  readonly incoming: readonly FriendRequestView[];
  readonly outgoing: readonly FriendRequestView[];
}): z.infer<typeof FriendRequestsSchema> => ({
  incoming: lists.incoming.map(viewDto),
  outgoing: lists.outgoing.map(viewDto),
});

export const sentFriendRequestDto = (sent: SentFriendRequest): z.infer<typeof SentFriendRequestSchema> => ({
  ...viewDto(sent),
  status: sent.status,
  ...(sent.status === "ACCEPTED" ? { spaceId: sent.spaceId } : {}),
});

export const AcceptedFriendRequestSchema = z.object({
  spaceId: z.string().meta({ description: "The pair's direct space, new or the active one reused" }),
});

const RequestPath = z.object({ requestId: z.string() });

export const friendRequestsPaths: ZodOpenApiPathsObject = {
  "/api/v1/me/friend-requests": {
    get: {
      operationId: "listFriendRequests",
      summary: "The friend requests the signed-in person received and sent (P339)",
      ...securedByUser,
      responses: {
        "200": { description: "Incoming and outgoing requests", content: jsonContent(FriendRequestsSchema) },
        ...problems({ "401": "Unauthenticated" }),
      },
    },
    post: {
      operationId: "sendFriendRequest",
      summary: "Ask someone to be a friend, by their exact @usuario (P339)",
      description:
        "One open request per pair: a second one answers the open one. When the other person already asked the caller, sending accepts their request and the pair's direct space is created (or the active one reused). Throttled per person with the @ lookup.",
      ...securedByUser,
      requestBody: { content: jsonContent(SendFriendRequestBodySchema) },
      responses: {
        "201": { description: "A new pending request", content: jsonContent(SentFriendRequestSchema) },
        "200": {
          description: "The pair's open request, or the other's request accepted",
          content: jsonContent(SentFriendRequestSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "UserNotFound",
          "409": "AlreadyFriends",
          "422": "ValidationFailed, OwnHandle",
          "429": "TooManyRequests",
        }),
      },
    },
  },
  "/api/v1/me/friend-requests/{requestId}/accept": {
    post: {
      operationId: "acceptFriendRequest",
      summary: "Accept a friend request the signed-in person received (P339)",
      description:
        "Creates the pair's direct space, or reuses the active one; both people then see each other in Amigos.",
      ...securedByUser,
      requestParams: { path: RequestPath },
      responses: {
        "200": { description: "Accepted", content: jsonContent(AcceptedFriendRequestSchema) },
        ...problems({ "401": "Unauthenticated", "404": "FriendRequestNotFound" }),
      },
    },
  },
  "/api/v1/me/friend-requests/{requestId}/reject": {
    post: {
      operationId: "rejectFriendRequest",
      summary: "Turn down a friend request the signed-in person received (P339)",
      description: "Silent: the sender keeps seeing the request as sent.",
      ...securedByUser,
      requestParams: { path: RequestPath },
      responses: {
        "204": { description: "Turned down" },
        ...problems({ "401": "Unauthenticated", "404": "FriendRequestNotFound" }),
      },
    },
  },
};
