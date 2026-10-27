import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the plan and its tabs, shown at once while the screen renders. Reached from the navigation, it has no header. */
export default function Loading() {
  return <LoadingScreen shape="cards" />;
}
