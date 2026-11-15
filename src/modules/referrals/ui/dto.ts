import type { paths } from "@/shared/ui/api/schema";

type Json<T> = T extends { content: { "application/json": infer B } } ? B : never;

/** D27: the person's link, points and the people who joined with it, as `GET /api/v1/me/referrals` answers them. */
export type MyReferralsDto = Json<paths["/api/v1/me/referrals"]["get"]["responses"][200]>;
/** D27: all a referral link says of its owner. */
export type ReferralPreviewDto = Json<paths["/api/v1/referrals/{code}"]["get"]["responses"][200]>;
