import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the balances of a space, shown at once while the screen renders. Reached from the navigation, it has no header. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[720px]">
      <LoadingScreen shape="cards" />
    </div>
  );
}
