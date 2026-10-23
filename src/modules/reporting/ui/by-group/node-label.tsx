import { useTranslations } from "next-intl";
import type { NodeName } from "./spending-tree";

/** A node's name as text: as stored, scoped to its space through one catalog pattern, or the "no subcategory" entry. */
export const useNodeText = () => {
  const t = useTranslations("reports");
  return (name: NodeName): string => {
    if (name.kind === "plain") return name.name;
    if (name.kind === "scoped") return t("spaceScoped", { space: name.space, name: name.name });
    return t("byGroup.noSubcategory");
  };
};

export function NodeLabel({ name }: { readonly name: NodeName }) {
  return <>{useNodeText()(name)}</>;
}
