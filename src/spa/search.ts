import { searchRecordOf } from "@/shared/ui/api/readers";

/**
 * The query string as the Next.js pages read it (ADR 0006 keeps every URL): plain names and values, a repeated name is a
 * list. TanStack Router's default would read `?expired=1` as the number 1 and write strings back in JSON quotes.
 */
export const parseSearch = (search: string): Record<string, string | string[]> =>
  searchRecordOf(search.startsWith("?") ? search.slice(1) : search);

export const stringifySearch = (search: Record<string, unknown>): string => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      if (one !== undefined && one !== null) query.append(name, String(one));
    }
  }
  const text = query.toString();
  return text ? `?${text}` : "";
};

/** One text parameter, as a page reads `searchParams.x` when it expects a single value. */
export const textParam = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** A parameter that may repeat, as `invitationOf` reads it. */
export const textsParam = (value: unknown): string | string[] | undefined =>
  typeof value === "string" || (Array.isArray(value) && value.every((one) => typeof one === "string"))
    ? (value as string | string[])
    : undefined;
