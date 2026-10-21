import type { ReactNode } from "react";
import { AppShellContainer } from "@/modules/spaces/ui/server";

export default function NewSpaceLayout({ children }: { readonly children: ReactNode }) {
  return <AppShellContainer spaceId={null}>{children}</AppShellContainer>;
}
