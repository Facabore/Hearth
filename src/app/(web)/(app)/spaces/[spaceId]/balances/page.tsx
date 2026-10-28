import { getTranslations } from "next-intl/server";
import { BalancesContainer } from "@/modules/balances/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("balances"))("title") };
}

/**
 * HU-E9-07: who owes whom in a shared or direct space, the settle-up suggestions and the settle-up sheet. `?settle=` is
 * a member id (the guest sheet's "Registrar pago" link): the sheet opens with that member paying.
 */
export default routeScreen<{ spaceId: string }, { settle?: string | string[] }>(
  async ({ spaceId }, { settle }) => (
    <div className="mx-auto max-w-[720px] py-3">
      {await BalancesContainer({ spaceId, settle: typeof settle === "string" ? settle : undefined })}
    </div>
  ),
);
