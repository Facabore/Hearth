import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the home of a space (and any screen under it without its own boundary), shown at once while the screen renders. Reached from the navigation, it has no header. */
export default function Loading() {
  return <LoadingScreen shape="cards" />;
}
