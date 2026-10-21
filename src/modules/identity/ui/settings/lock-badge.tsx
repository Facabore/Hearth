import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui";

/** HU-E9-13: a field the installation rules lock (HU-E8-18 sets them; the profile only reads them). */
export function LockBadge() {
  const t = useTranslations("settings");
  return <Badge icon="lock">{t("locked")}</Badge>;
}
