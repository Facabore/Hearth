import { getTranslations } from "next-intl/server";
import { BalancesContainer } from "@/modules/balances/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("balances"))("title") };
}

/**
 * HU-E9-07: who owes whom in a shared or direct space, the settle-up suggestions and the settle-up sheet. `?settle=` is
 * a member id (the guest sheet's "Registrar pago" link): the sheet opens with that member paying.
 */
export default async function BalancesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ settle?: string | string[] }>;
}) {
  const { settle } = await searchParams;
  return (
    <div className="mx-auto max-w-[720px] py-4">
      <BalancesContainer
        spaceId={(await params).spaceId}
        settle={typeof settle === "string" ? settle : undefined}
      />
    </div>
  );
}
