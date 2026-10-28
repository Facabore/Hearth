import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: a member's history; its title names the member, so it reads "Cargando…" until then, and the relative way back is the balances. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[720px]">
      <LoadingScreen header={{ backHref: "../../balances" }} shape="list" />
    </div>
  );
}
