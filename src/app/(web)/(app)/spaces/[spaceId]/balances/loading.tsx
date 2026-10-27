import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the balances, reached from the navigation: no header. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[720px]">
      <LoadingScreen shape="cards" />
    </div>
  );
}
