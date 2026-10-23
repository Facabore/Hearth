import { getMe } from "@/shared/ui/api/server";
import { SettingsForm } from "./settings-form";

/** Server: the person's preferences; the shell already sent a missing session to the sign-in screen. */
export async function SettingsContainer({ backHref }: { readonly backHref: string }) {
  return <SettingsForm me={(await getMe())!} backHref={backHref} />;
}
