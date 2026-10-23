import { clsx, type ClassValue } from "clsx";

/**
 * Class names joined, falsy ones dropped. It does not resolve conflicting Tailwind utilities (tailwind-merge was
 * about 9 KiB of script on every route, ruling P134): a component picks one class per concern, through a variant or a
 * ternary, instead of overriding an earlier one.
 */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
