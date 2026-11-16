import { CURRENCY_CODES } from "@/shared/kernel/currency-codes";

/**
 * D29 (board 13): the ISO 4217 currencies the sheet offers: exactly the kernel's (`currency-codes.ts`, which the SPA
 * may read under ruling P119's allow-list), in code order, so a code the sheet offers is one the server accepts.
 */
export const knownCurrencyCodes = (): readonly string[] => CURRENCY_CODES;
