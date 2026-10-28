import { useTranslations } from "use-intl";
import { useTitle } from "../title";

/** Slice 1 of #199 stops at the shell: the home's content moves in slice 2 (the ledger flow). */
export function SpaceHome() {
  const title = useTranslations("home")("title");
  useTitle(title);
  return <h1 className="pt-4 text-2xl font-semibold text-ink">{title}</h1>;
}
