import type { ReactNode } from "react";
import { AppShellContainer } from "@/modules/spaces/ui";

export default function SettingsLayout({ children }: { readonly children: ReactNode }) {
  return <AppShellContainer spaceId={null}>{children}</AppShellContainer>;
}
