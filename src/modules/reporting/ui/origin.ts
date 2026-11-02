import { useTranslations } from "next-intl";

/** #240 (boards E9-11 01 and 02): where a personal row came from, as the API listed its spaces. */
export type Origin =
  | { readonly kind: "spaces"; readonly names: readonly string[] }
  /** One space's own row: board E9-11 01 reads "Hogar · tu parte". */
  | { readonly kind: "yourShare"; readonly space: string }
  /** A group a space created: board E9-11 02 reads "Grupo creado en Hogar". */
  | { readonly kind: "createdIn"; readonly space: string };

/** Names as one phrase, in the API's order: "Hogar", "Personal y Hogar", "Personal, Hogar y Viaje". */
export const useNamesText = () => {
  const t = useTranslations("reports.origin");
  return (names: readonly string[]): string =>
    names.length < 2
      ? (names[0] ?? "")
      : t("and", { list: names.slice(0, -1).join(", "), last: names.at(-1)! });
};

/** The line under a row's name: "Personal y Hogar", "Hogar · tu parte", "Grupo creado en Hogar". */
export const useOriginText = () => {
  const t = useTranslations("reports.origin");
  const namesText = useNamesText();
  return (origin: Origin): string => {
    if (origin.kind === "yourShare") return t("yourShare", { space: origin.space });
    if (origin.kind === "createdIn") return t("createdIn", { space: origin.space });
    return namesText(origin.names);
  };
};
