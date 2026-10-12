import { v7 } from "uuid";
import type { Id, IdGenerator } from "@/shared/kernel";

export class UuidV7IdGenerator implements IdGenerator {
  next<B extends string>(): Id<B> {
    return v7() as Id<B>;
  }
}
