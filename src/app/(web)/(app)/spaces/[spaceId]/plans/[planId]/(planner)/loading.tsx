import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the planner; its title names the period, so it reads "Cargando…" until then, and the relative way back is the Plan tab. */
export default function Loading() {
  return <LoadingScreen header={{ backHref: "../../plan" }} shape="list" />;
}
