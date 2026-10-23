import type { ReactNode } from "react";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";

/** Ruling P195: one provider above every space's layout, so a toast survives the navigation after a save. */
export default function SignedInLayout({ children }: { readonly children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
