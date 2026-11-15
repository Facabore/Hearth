import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, problems, securedByUser } from "@/shared/http/contracts";
import type { MyReferrals, ReferralPreview } from "../application";

/** D27: all a referral link says of its owner. */
export const ReferralPreviewSchema = z.object({
  firstName: z.string().describe("The first word of the referrer's name; never their email or id."),
});

export const MyReferralsSchema = z.object({
  code: z.string().describe("The person's referral code, created the first time it is read."),
  link: z.string().describe("The link the code is shared as: <origin>/r/<code>."),
  points: z
    .number()
    .int()
    .min(0)
    .describe("One per referral whose person confirmed their email; counted on read, never stored."),
  items: z
    .array(
      z.object({
        firstName: z.string(),
        joinedOn: z.iso.date().describe("The day the account was created, in the referrer's time zone."),
        counts: z
          .boolean()
          .describe("Whether it earns its point: the referred person confirmed their email."),
      }),
    )
    .describe("The people who joined with the link, newest first; never their email or id."),
});

/** D27: the code of the link the person signed up through, as the SPA remembered it. */
export const ClaimReferrerBodySchema = z.object({ code: z.string().min(1).max(64) });

export const referralPreviewDto = (preview: ReferralPreview) => ({ firstName: preview.firstName });

export const myReferralsDto = (mine: MyReferrals) => ({
  code: mine.code,
  link: mine.link,
  points: mine.points,
  items: mine.items.map((item) => ({
    firstName: item.firstName,
    joinedOn: item.joinedOn,
    counts: item.counts,
  })),
});

export const referralsPaths: ZodOpenApiPathsObject = {
  "/api/v1/referrals/{code}": {
    get: {
      operationId: "previewReferral",
      summary: "The first name of a referral link's owner (D27), public",
      description:
        "Answers only the referrer's first name. An unknown code and a malformed one answer the same 404, so the " +
        "answer helps nobody tell one from the other.",
      requestParams: { path: z.object({ code: z.string() }) },
      responses: {
        "200": { description: "The referrer's first name", content: jsonContent(ReferralPreviewSchema) },
        ...problems({ "404": "ReferralCodeNotFound" }),
      },
    },
  },
  "/api/v1/me/referrals": {
    get: {
      operationId: "getMyReferrals",
      summary: "The signed-in person's referral link, points and the people who joined with it (D27)",
      ...securedByUser,
      responses: {
        "200": { description: "The person's referrals", content: jsonContent(MyReferralsSchema) },
        ...problems({ "401": "Unauthenticated" }),
      },
    },
  },
  "/api/v1/me/referrer": {
    post: {
      operationId: "claimReferrer",
      summary: "Make the owner of a referral code the signed-in person's referrer (D27)",
      description:
        "Accepted only when the code is not the person's own, they have no referrer yet and their account was " +
        "created less than 24 hours ago. The same claim again answers 204 too.",
      ...securedByUser,
      requestBody: { content: jsonContent(ClaimReferrerBodySchema) },
      responses: {
        "204": { description: "The code's owner is the person's referrer" },
        ...problems({
          "401": "Unauthenticated",
          "404": "ReferralCodeNotFound",
          "409": "OwnReferralCode, AlreadyReferred, ReferralWindowClosed",
          "422": "ValidationFailed",
        }),
      },
    },
  },
};
