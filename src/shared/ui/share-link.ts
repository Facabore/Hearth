/** Ruling P339 (S6): the link that opens Agregar amigo with this @ filled in. */
export const friendLinkOf = (handle: string): string => `/f/${encodeURIComponent(handle)}`;

/** What sharing a link did: the device shared it, the person closed its sheet, it was copied, or it could not be. */
export type ShareOutcome = "shared" | "dismissed" | "copied" | "copyFailed";

/**
 * Rulings P339 and P343: the device's share sheet where there is one, otherwise the clipboard. Closing the share sheet
 * says nothing; any other refusal of it falls back to copying.
 */
export const shareLink = async ({
  url,
  text,
}: {
  readonly url: string;
  readonly text: string;
}): Promise<ShareOutcome> => {
  try {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url });
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "dismissed";
      }
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "copyFailed";
  }
};
