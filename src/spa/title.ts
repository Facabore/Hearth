import { useEffect } from "react";

/** The tab's title, as the Next.js metadata template writes it ("%s · Hearth"). */
export const useTitle = (title?: string): void => {
  useEffect(() => {
    document.title = title ? `${title} · Hearth` : "Hearth";
  }, [title]);
};
