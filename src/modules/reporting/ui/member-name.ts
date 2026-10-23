import type { useTranslations } from "next-intl";
import type { MemberDto } from "@/shared/ui/api/dto";

/** A member's display name, or "Former member" for one the space no longer lists (their figures still count). */
export const memberName = (
  members: readonly Pick<MemberDto, "id" | "displayName">[],
  memberId: string,
  t: ReturnType<typeof useTranslations<"reports">>,
): string => members.find((member) => member.id === memberId)?.displayName ?? t("matrix.formerMember");
