import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  FixedClock,
  ok,
  type Id,
  type IdGenerator,
  type TransactionManager,
} from "@/shared/kernel";
import type { Space } from "../domain/space";
import { createCreatePersonalSpace, type SpaceCreatedListener } from "./create-personal-space";
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
const noop: SpaceCreatedListener = async () => ok(undefined);
const ana = { userId: "u-ana", name: "Ana", locale: "es" };

describe("CreatePersonalSpace", () => {
  it("creates exactly one personal space for the owner", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock, tm, onCreated: noop });
    const result = await create(ana);
    expect(result.ok).toBe(true);
    expect(spaces.saved).toHaveLength(1);
    expect(spaces.saved[0]).toMatchObject({ id: "id-1", kind: "PERSONAL", personalOwnerUserId: "u-ana" });
  });

  it("refuses a second personal space", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock, tm, onCreated: noop });
    await create(ana);
    const second = await create(ana);
    expect(!second.ok && second.error.code).toBe("PersonalSpaceAlreadyExists");
    expect(spaces.saved).toHaveLength(1);
  });

  it("lets listeners react to the new space with the owner's locale (HU-E3-01)", async () => {
    const seen: [string, string][] = [];
    const create = createCreatePersonalSpace({
      spaces: new InMemorySpaces(),
      ids: ids(),
      clock,
      tm,
      onCreated: async (space, { locale }) => {
        seen.push([space.id, locale]);
        return ok(undefined);
      },
    });
    await create({ ...ana, locale: "en" });
    expect(seen).toEqual([["id-1", "en"]]);
  });

  it("fails when a listener fails, so the surrounding transaction rolls back", async () => {
    const create = createCreatePersonalSpace({
      spaces: new InMemorySpaces(),
      ids: ids(),
      clock,
      tm,
      onCreated: async () => err(domainError("SeedFailed")),
    });
    const result = await create(ana);
    expect(!result.ok && result.error.code).toBe("SeedFailed");
  });
});
