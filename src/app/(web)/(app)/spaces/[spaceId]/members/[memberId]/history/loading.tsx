import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/**
 * Issue #196: a member's history. Its title names the member, which waits on the data, so the header reads
 * "Cargando…" until then; the relative way back leads to the balances, as the loaded screen's does.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[720px]">
      <LoadingScreen header={{ backHref: "../../balances" }} shape="list" />
    </div>
  );
}
