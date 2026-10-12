export type Id<B extends string> = string & { readonly __brand: B };

export interface IdGenerator {
  next<B extends string>(): Id<B>;
}
