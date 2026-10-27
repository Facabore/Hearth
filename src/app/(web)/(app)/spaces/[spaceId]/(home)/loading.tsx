import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the home of a space, reached from the navigation: no header. */
export default function Loading() {
  return <LoadingScreen shape="cards" />;
}
