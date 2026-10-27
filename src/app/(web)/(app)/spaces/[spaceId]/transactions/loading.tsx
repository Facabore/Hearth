import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the transactions of a space, shown at once while the screen renders. Reached from the navigation, it has no header. */
export default function Loading() {
  return <LoadingScreen shape="list" />;
}
