import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the transactions, reached from the navigation: no header. */
export default function Loading() {
  return <LoadingScreen shape="list" />;
}
