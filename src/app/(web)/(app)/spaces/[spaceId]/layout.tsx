import type { ReactNode } from "react";
import { AppShellContainer } from "@/modules/spaces/ui";

export default async function SpaceLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ spaceId: string }>;
}) {
  return <AppShellContainer spaceId={(await params).spaceId}>{children}</AppShellContainer>;
}
