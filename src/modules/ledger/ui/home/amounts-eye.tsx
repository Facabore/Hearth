import { useTranslations } from "next-intl";
import { useState } from "react";
import { createPortal } from "react-dom";
import { HEADER_SLOT_ID, setAmountsHidden, useAmountsHidden } from "@/modules/spaces/ui";
import { Icon } from "@/shared/ui";

/**
 * Inicio's eye (board B1 · 03, ruling P278): it hides every amount on Inicio and in the space switcher, and this
 * browser remembers it per person. It sits in the shell's header, beside the profile; outside the shell, over the page.
 */
export function AmountsEye({ personId }: { readonly personId: string }) {
  const t = useTranslations("home");
  const hidden = useAmountsHidden(personId);
  // The shell's header slot; null outside the shell.
  const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined);
  const eye = (
    <button
      type="button"
      aria-label={t("hideAmounts")}
      aria-pressed={hidden}
      onClick={() => setAmountsHidden(personId, !hidden)}
      className="relative flex size-11 items-center justify-center rounded-full text-muted"
    >
      <Icon name="eye" size={22} />
      {/* Hidden amounts strike the eye through. */}
      {hidden ? (
        <span aria-hidden="true" className="absolute h-0.5 w-6 rotate-45 rounded-full bg-current" />
      ) : null}
    </button>
  );
  // A ref attaches once the whole tree is in the document, header included, and before the first paint.
  if (slot === undefined)
    return <span hidden ref={(node) => void (node && setSlot(document.getElementById(HEADER_SLOT_ID)))} />;
  return slot ? createPortal(eye, slot) : <div className="flex justify-end lg:col-span-2">{eye}</div>;
}
