/**
 * HU-E3-05: the style of a category group created without one, and of the custom groups that existed before 0017. The
 * categories domain stores it (typed as its CategoryStyle) and the group sheet preselects it, both through `style.ts`.
 */
export const CUSTOM_GROUP_STYLE = { icon: { kind: "SYMBOL", name: "tag" }, color: "GRAPHITE" } as const;
