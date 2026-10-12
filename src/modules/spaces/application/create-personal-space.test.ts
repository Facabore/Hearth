import { describe, expect, it } from "vitest";
import { FixedClock, type Id, type IdGenerator, type TransactionManager } from "@/shared/kernel";
import type { Space } from "../domain/space";
import { createCreatePersonalSpace } from "./create-personal-space";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

class InMemorySpaces implements SpaceRepository {
  readonly saved: Space[] = [];
  async add(space: Space) {
    this.saved.push(space);
  }
  async hasPersonalSpace(userId: string) {
    return this.saved.some((s) => s.kind === "PERSONAL" && s.personalOwnerUserId === userId);
  }
  async listForUser(): Promise<SpaceSummary[]> {
    return [];
  }
}

const ids = (): IdGenerator => {
  let n = 0;
  return { next: <B extends string>() => `id-${++n}` as Id<B> };
};
const tm: TransactionManager = { run: (work) => work() };
const clock = new FixedClock(new Date("2026-10-11T00:00:00Z"));

describe("CreatePersonalSpace", () => {
  it("creates exactly one personal space for the owner", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock, tm });
    const result = await create({ userId: "u-ana", name: "Ana" });
    expect(result.ok).toBe(true);
    expect(spaces.saved).toHaveLength(1);
    expect(spaces.saved[0]).toMatchObject({ id: "id-1", kind: "PERSONAL", personalOwnerUserId: "u-ana" });
  });

  it("refuses a second personal space", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock, tm });
    await create({ userId: "u-ana", name: "Ana" });
    const second = await create({ userId: "u-ana", name: "Ana" });
    expect(!second.ok && second.error.code).toBe("PersonalSpaceAlreadyExists");
    expect(spaces.saved).toHaveLength(1);
  });
});
