import type { InvitationPreviewDto } from "@/shared/ui/api/dto";

export type PageState = "visitor" | "signedIn" | "expired" | "revoked" | "used" | "missing";

/** Ruling P165: what an invitation or claim page shows, from the preview's status and whether someone is signed in. */
export const pageStateOf = (status: InvitationPreviewDto["status"] | null, signedIn: boolean): PageState => {
  if (status === null) return "missing";
  if (status === "EXPIRED") return "expired";
  if (status === "REVOKED") return "revoked";
  if (status === "ACCEPTED") return "used";
  return signedIn ? "signedIn" : "visitor";
};
