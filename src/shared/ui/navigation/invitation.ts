/** Ruling P147: the invitation token of `?invitation=`; an empty or repeated parameter names none. */
export const invitationOf = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
