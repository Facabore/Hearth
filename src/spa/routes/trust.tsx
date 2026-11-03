import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { signUpHrefOf } from "@/modules/identity/ui";
import { ScreenHeader } from "@/shared/ui";
import { safeNext } from "@/shared/ui/navigation/auth-redirect";
import { invitationOf } from "@/shared/ui/navigation/invitation";
import { useApis } from "../api";
import { meQuery, spacesQuery } from "../queries";
import { useTitle } from "../title";

/** Ruling P290: the five points, in the order the owner approved them on 2026-11-02. */
const POINTS = ["bank", "server", "visibility", "deletes", "backups"] as const;

/** Issue #146, ruling P290: what Hearth does and never does with the person's data, as plain sentences. */
export function TrustPage({ backHref }: { readonly backHref: string }) {
  const t = useTranslations("trust");
  return (
    <div className="flex flex-col gap-3">
      <ScreenHeader backHref={backHref} title={t("title")} />
      <ul className="flex flex-col gap-3">
        {POINTS.map((point) => (
          <li
            key={point}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-[15px] leading-[22px] [overflow-wrap:anywhere] text-ink"
          >
            {t(`points.${point}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const route = getRouteApi("/_open/trust");

/**
 * Ajustes' link carries the space the person came from (`?from=`); Volver keeps it only when it is one of her own
 * spaces, as Ajustes itself reads it (N3).
 */
function SignedInTrust({ from }: { readonly from: string | undefined }) {
  const { api } = useApis();
  const spaces = useSuspenseQuery(spacesQuery(api)).data;
  const own = spaces.find((space) => space.id === from);
  return <TrustPage backHref={own ? `/settings?from=${encodeURIComponent(own.id)}` : "/settings"} />;
}

/**
 * Issue #146: the trust page, open to anyone in the public frame. A visitor came from sign-up, so Volver goes back
 * there with where they were going and the invitation they hold; a signed-in person came from Ajustes.
 */
export function TrustRoute() {
  const { next, invitation, from } = route.useSearch();
  const { sessionApi } = useApis();
  const me = useSuspenseQuery(meQuery(sessionApi)).data;
  useTitle(useTranslations("trust")("title"));
  if (me) return <SignedInTrust from={from} />;
  return <TrustPage backHref={signUpHrefOf(safeNext(next), invitationOf(invitation))} />;
}
