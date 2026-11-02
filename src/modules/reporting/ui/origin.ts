import { useTranslations } from "next-intl";

/** #240 (boards E9-11 01 and 02): where a personal row came from, as the API listed its spaces. */
export type Origin =
  | { readonly kind: "spaces"; readonly names: readonly string[] }
  /** One space's own row: board E9-11 01 reads "Hogar · tu parte". */
  | { readonly kind: "yourShare"; readonly space: string }
  /** A group a space created: board E9-11 02 reads "Grupo creado en Hogar". */
  | { readonly kind: "createdIn"; readonly space: string };

/** The line under a row's name: "Personal y Hogar", "Personal, Hogar y Viaje", "Hogar · tu parte". */
export const useOriginText = () => {
  const t = useTranslations("reports.origin");
  return (origin: Origin): string => {
    if (origin.kind === "yourShare") return t("yourShare", { space: origin.space });
    if (origin.kind === "createdIn") return t("createdIn", { space: origin.space });
    const { names } = origin;
    return names.length < 2
      ? (names[0] ?? "")
      : t("and", { list: names.slice(0, -1).join(", "), last: names.at(-1)! });
  };
};
