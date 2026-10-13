import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, PeriodSchema, problemContent, problems, securedByUser } from "@/shared/http/contracts";
import type { CreatedInvitation, InvitationView, SpaceMember } from "../application";

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

/** HU-E1-04: shared spaces are created here; PERSONAL answers PersonalSpaceAlreadyExists (HU-E1-02); DIRECT never (D16). */
export const CreateSpaceBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PERSONAL") }),
  z.object({
    kind: z.literal("SHARED"),
    name: z.string().max(200),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" })
      .default("COP"),
  }),
]);

const RoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);

/** A current member (HU-E1-05, HU-E1-10): guests have kind GUEST, no user and no role. */
export const SpaceMemberSchema = z.object({
  id: z.string(),
  kind: z.enum(["USER", "GUEST"]),
  userId: z.string().nullable(),
  displayName: z.string(),
  role: RoleSchema.nullable(),
  contactEmail: z.string().nullable(),
  joinedAt: z.iso.datetime(),
});
export const ListMembersResponseSchema = z.object({ items: z.array(SpaceMemberSchema) });

export const memberDto = (member: SpaceMember): z.infer<typeof SpaceMemberSchema> => ({
  id: member.id,
  kind: member.kind,
  userId: member.userId,
  displayName: member.displayName,
  role: member.role,
  contactEmail: member.contactEmail,
  joinedAt: member.joinedAt.toISOString(),
});

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

/** `role` accepts OWNER so the domain answers InvalidInvitationRole (HU-E1-06) instead of ValidationFailed. */
export const CreateInvitationBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EMAIL"), email: z.email().max(254), role: RoleSchema }),
  z.object({ kind: z.literal("LINK"), role: RoleSchema }),
]);

/** Never carries the token or its hash; EXPIRED is derived from expiresAt. */
export const InvitationSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  kind: z.enum(["EMAIL", "LINK"]),
  email: z.string().nullable(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  status: z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const CreatedInvitationSchema = z.object({
  invitation: InvitationSchema,
  /** The web URL carrying only the token; shown once, since only the token's hash is stored. */
  url: z.string(),
  emailSent: z.boolean(),
});

export const invitationDto = (view: InvitationView): z.infer<typeof InvitationSchema> => ({
  id: view.id,
  spaceId: view.spaceId,
  kind: view.kind,
  email: view.email,
  role: view.role,
  status: view.status,
  createdAt: view.createdAt.toISOString(),
  expiresAt: view.expiresAt.toISOString(),
});

export const createdInvitationDto = (
  created: CreatedInvitation,
): z.infer<typeof CreatedInvitationSchema> => ({
  invitation: invitationDto(created.invitation),
  url: created.url,
  emailSent: created.emailSent,
});

const SpacePath = z.object({ spaceId: z.string() });
const InvitationPath = SpacePath.extend({ invitationId: z.string() });

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
    post: {
      operationId: "createSpace",
      summary:
        "Create a shared space with the requester as its only OWNER (personal spaces come with sign-up)",
      ...securedByUser,
      requestBody: { content: jsonContent(CreateSpaceBodySchema) },
      responses: {
        "201": { description: "The new space", content: jsonContent(SpaceSummarySchema) },
        ...problems({
          "401": "Unauthenticated",
          "409": "PersonalSpaceAlreadyExists",
          "422": "ValidationFailed, InvalidSpaceName, UnknownCurrency",
        }),
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
  "/api/v1/spaces/{spaceId}/members": {
    get: {
      operationId: "listMembers",
      summary: "Current members of the space in join order, guests included",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "The current members", content: jsonContent(ListMembersResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/invitations": {
    post: {
      operationId: "createInvitation",
      summary: "Invite by email (bound to that address) or by shareable link; the response carries the URL",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreateInvitationBodySchema) },
      responses: {
        "201": {
          description: "The pending invitation, its URL and whether an email was sent",
          content: jsonContent(CreatedInvitationSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "AlreadyMember, PersonalSpaceNotShareable",
          "422": "ValidationFailed, InvalidInvitationRole, InvalidEmail",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke": {
    post: {
      operationId: "revokeInvitation",
      summary: "Revoke a pending invitation; revoking twice changes nothing",
      ...securedByUser,
      requestParams: { path: InvitationPath },
      responses: {
        "200": { description: "The revoked invitation", content: jsonContent(InvitationSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, InvitationNotFound",
          "409": "InvitationAlreadyUsed",
        }),
      },
    },
  },
};
