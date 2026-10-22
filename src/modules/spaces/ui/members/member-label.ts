import type { MemberDto } from "@/shared/ui/api/dto";

export type MemberLabelT = (key: "you" | "guestSuffix", values?: { name: string }) => string;

/**
 * HU-E9-05: a member as every household screen names them: the viewer as "Ana (tú)", a guest with the story's
 * `members.guestSuffix` ("Pedro (invitado)"), anyone else by their stored name.
 */
export const memberLabel = (
  member: Pick<MemberDto, "displayName" | "kind" | "userId">,
  meUserId: string,
  t: MemberLabelT,
): string => {
  if (member.userId !== null && member.userId === meUserId) return t("you", { name: member.displayName });
  return member.kind === "GUEST" ? `${member.displayName} ${t("guestSuffix")}` : member.displayName;
};
