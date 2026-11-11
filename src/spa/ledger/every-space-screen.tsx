import { EverySpaceList } from "@/modules/ledger/ui";
import { nowIn } from "@/shared/ui/time/when";
import { useEverySpaceList } from "./list-hooks";
import { ListDetail, useListState, type ListScreenProps } from "./list-screen";

/** Ruling P319: the personal Movimientos across every current space of the person. */
export function EverySpaceScreen({ viewer, filter, search }: ListScreenProps) {
  const { page, context, spaces, previous, next, periods } = useEverySpaceList(viewer, filter);
  const { me, space } = viewer;
  const { written, pendingNames, fund } = useListState(
    viewer,
    search,
    spaces.flatMap((s) => s.accounts),
  );
  return (
    <>
      <EverySpaceList
        key={written}
        spaceId={space.id}
        page={page}
        context={context}
        today={nowIn(new Date(), me.timezone).date}
        filter={filter}
        spaces={spaces}
        {...(fund ? { notice: { accountName: fund.name, balance: fund.balance } } : {})}
        periodPolicy={space.periodPolicy}
        previous={previous}
        next={next}
        periods={periods}
        pendingCount={pendingNames.length}
        pendingNames={pendingNames}
      />
      <ListDetail viewer={viewer} filter={filter} context={context} tx={search.tx} />
    </>
  );
}
