import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the Plan tab's member matrix, reached from its tabs: no header. */
export default function Loading() {
  return <LoadingScreen shape="cards" />;
}
