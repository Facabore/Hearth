import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: a line of a plan; its title names the line, so it reads "Cargando…" until then, and the relative way back is its planner. */
export default function Loading() {
  return <LoadingScreen header={{ backHref: "../.." }} shape="form" />;
}
