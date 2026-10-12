export type Id<B extends string> = string & { readonly __brand: B };

export interface IdGenerator {
  next<B extends string>(): Id<B>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical textual UUID; repositories check identifiers from URLs before querying `uuid` columns. */
export const isUuid = (value: string): boolean => UUID.test(value);
