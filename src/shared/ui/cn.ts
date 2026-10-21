import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind classes joined, falsy ones dropped, conflicting utilities resolved in favour of the later one. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
