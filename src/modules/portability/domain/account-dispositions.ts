import type { SourceAccount } from "./source-snapshot";

/** One of the importing person's accounts, as `mapping-proposals`' `HearthAccount` has it. */
export interface DispositionAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly archived: boolean;
}

/** P337, board 1 "¿Qué es cada cuenta?": what a source account is. */
export type AccountDisposition = "ACCOUNT" | "PERSON" | "ARCHIVE";

/** What Hearth preselects for one source account; an Archivar names the person's account it duplicates, if any. */
export type DispositionSuggestion =
  | { readonly kind: "ACCOUNT" }
  | { readonly kind: "PERSON" }
  | { readonly kind: "ARCHIVE"; readonly duplicateOf: DispositionAccount | null };

/** What the suggestion reads besides the account itself. */
export interface DispositionFacts {
  /** An earlier import that still stands linked it to a live account of the person's. */
  readonly linked: boolean;
  /** The snapshot's movements that touch it, as source or destination. */
  readonly movementCount: number;
  readonly closingBalanceMinor: bigint;
  /** A Persona's movements are settlements, which the direct space keeps in this currency. */
  readonly spaceCurrency: string;
  /** The importing person's accounts in the space, archived ones included. */
  readonly accounts: readonly DispositionAccount[];
}

/** Case- and accent-insensitive, trimmed: "Tía " and "tia" are the same word. */
const folded = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

const wordsOf = (text: string): string[] =>
  folded(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const LOAN_WORDS = new Set(["loan", "prestamo"]);

const RELATIONSHIP_WORDS = new Set([
  "mom",
  "mama",
  "madre",
  "dad",
  "papa",
  "padre",
  "brother",
  "hermano",
  "hermana",
  "sister",
  "tio",
  "tia",
  "abuela",
  "abuelo",
  "primo",
  "prima",
  "amigo",
  "amiga",
  "friend",
]);

/**
 * Stems of an institution's name or product: a loan from one is a debt to keep as an account (type LOAN), never a
 * person. A word that starts with one counts ("Bancolombia", "hipotecario", "crédito").
 */
const INSTITUTION_STEMS = ["banc", "bank", "credit", "hipotec", "mortgage", "leasing", "icetex"];

/** A person's name, "Loan" or "Préstamo", or Money Manager's Loan group, unless an institution is named. */
const isPersonLike = (account: SourceAccount): boolean => {
  const words = wordsOf(account.name);
  if (words.some((word) => INSTITUTION_STEMS.some((stem) => word.startsWith(stem)))) return false;
  return account.loan === true || words.some((word) => LOAN_WORDS.has(word) || RELATIONSHIP_WORDS.has(word));
};

/** The names of the accounts Hearth seeds (issue 169) and Money Manager starts with, by what they are. */
const STARTER_NAMES: readonly ReadonlySet<string>[] = [
  new Set(["cash", "efectivo"]),
  new Set(["card", "tarjeta", "tarjeta de credito", "credit card"]),
  new Set(["accounts", "bank account", "bank accounts", "cuenta bancaria"]),
];

/**
 * The person's live account, in the same currency, that a starter account of the source duplicates under another
 * name ("Cash" beside "Efectivo"); none when the person has an account of the source's very name.
 */
export const starterDuplicateOf = (
  account: SourceAccount,
  accounts: readonly DispositionAccount[],
): DispositionAccount | undefined => {
  const name = folded(account.name);
  const names = STARTER_NAMES.find((set) => set.has(name));
  if (names === undefined) return undefined;
  const live = accounts.filter((a) => !a.archived);
  if (live.some((a) => folded(a.name) === name)) return undefined;
  return live.find(
    (a) => a.currency === account.currency && names.has(folded(a.name)) && folded(a.name) !== name,
  );
};

/**
 * P337: what Hearth preselects for a source account. A link from an earlier import that still stands keeps it a
 * Cuenta. Otherwise a person's name or a loan suggests Persona (in the space's currency only); a starter account's
 * duplicate, Money Manager's hidden flag, or no movements at a zero balance suggest Archivar (a duplicate first, so it
 * merges into the person's own account); anything else is a Cuenta.
 */
export const suggestDisposition = (
  account: SourceAccount,
  facts: DispositionFacts,
): DispositionSuggestion => {
  if (facts.linked) return { kind: "ACCOUNT" };
  if (account.currency === facts.spaceCurrency && isPersonLike(account)) return { kind: "PERSON" };
  const duplicate = starterDuplicateOf(account, facts.accounts);
  if (duplicate !== undefined) return { kind: "ARCHIVE", duplicateOf: duplicate };
  if (account.hidden || (facts.movementCount === 0 && facts.closingBalanceMinor === 0n)) {
    return { kind: "ARCHIVE", duplicateOf: null };
  }
  return { kind: "ACCOUNT" };
};

/** The longest guest name Hearth takes, as an account's (the spaces domain). */
const MAX_NAME = 60;

/**
 * The name a Persona's guest gets by default: the source's without its loan words ("Mom Loan" → "Mom"), or the
 * source's own when nothing else is left.
 */
export const personNameOf = (name: string): string => {
  const rest = name
    .replace(/(^|[^\p{L}\p{N}])(loan|pr[eé]stamo)(?=$|[^\p{L}\p{N}])/giu, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—·:,]+|[\s\-–—·:,]+$/g, "");
  return (rest === "" ? name.trim() : rest).slice(0, MAX_NAME);
};
