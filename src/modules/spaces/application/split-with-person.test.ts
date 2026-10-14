import { describe, expect, it } from "vitest";
import { FixedClock, ok } from "@/shared/kernel";
import { codeOf, memoryTm, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createPersonalSpace, type Space, type SpaceId, type SpaceMemberId } from "../domain/space";
import { createSpaceAccess } from "./space-access";
import {
  createSplitWithPerson,
  type DirectExpenseRecorder,
  type DirectSplitCounterpart,
} from "./split-with-person";

const now = new Date("2026-10-14T12:00:00Z");
// Household: OWNER Ana, MEMBER Juan and the guest Pedro. "Trip" belongs to Marta; Ana is not in it.
const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const PEDRO = memberOf("Pedro", null, 2);
const personalOf = (name: string, currency = "COP"): Space => ({
  ...createPersonalSpace({
    id: `space-${name.toLowerCase()}` as SpaceId,
    memberId: `member-${name.toLowerCase()}-personal` as SpaceMemberId,
    ownerUserId: `u-${name.toLowerCase()}`,
    ownerName: name,
    now,
  }),
  currency,
});

const world = (
  options: {
    store?: InMemorySpaceStore;
    recordExpense?: DirectExpenseRecorder<string, string>;
    anaCurrency?: string;
  } = {},
) => {
  const store = options.store ?? new InMemorySpaceStore();
  store.seed(householdSpace([ANA, JUAN, PEDRO]));
  store.seed({
    ...householdSpace([memberOf("Marta", "OWNER", 0)]),
    id: "space-trip" as SpaceId,
    name: "Trip",
  });
  store.seed(personalOf("Ana", options.anaCurrency));
  store.seed(personalOf("Juan"));
  const seeded: string[] = [];
  const recorded: { spaceId: string; userId: string; expense: string }[] = [];
  const split = createSplitWithPerson<string, string>({
    access: createSpaceAccess(store),
    spaces: store,
    direct: store,
    onCreated: async (space) => {
      seeded.push(space.id);
      return ok(undefined);
    },
    recordExpense:
      options.recordExpense ??
      (async (input) => {
        recorded.push(input);
        return ok(`expense in ${input.spaceId}`);
      }),
    ids: sequentialIds("id"),
    clock: new FixedClock(now),
    tm: memoryTm,
  });
  return { store, seeded, recorded, split };
};
const byAna = (counterpart: DirectSplitCounterpart) => ({
  userId: "u-ana",
  userName: "Ana",
  locale: "es",
  counterpart,
  expense: "Dinner 120,000",
});
const directSpaces = (store: InMemorySpaceStore) => store.spaces.filter((s) => s.kind === "DIRECT");

describe("SplitWithPerson with a new guest (HU-E1-13)", () => {
  it("creates 'Ana & Pedro' with Ana as OWNER and the new guest, seeds it and records the expense there", async () => {
    const w = world();
    expect(unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })))).toEqual({
      spaceId: "id-1",
      created: true,
      recorded: "expense in id-1",
    });
    const [space] = directSpaces(w.store);
    expect(space).toMatchObject({
      id: "id-1",
      name: "Ana & Pedro",
      kind: "DIRECT",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
    });
    expect(space?.members.map((m) => [m.id, m.displayName, m.kind, m.role])).toEqual([
      ["id-2", "Ana", "USER", "OWNER"],
      ["id-3", "Pedro", "GUEST", null],
    ]);
    expect(w.seeded).toEqual(["id-1"]);
    expect(w.recorded).toEqual([{ spaceId: "id-1", userId: "u-ana", expense: "Dinner 120,000" }]);
  });

  it("keeps the new guest's contact email on the member, and null when none was given", async () => {
    const w = world();
    unwrap(await w.split(byAna({ guest: { displayName: "Pedro", contactEmail: "pedro@example.com" } })));
    unwrap(await w.split(byAna({ guest: { displayName: "Luis" } })));
    expect(directSpaces(w.store).map((s) => s.members.map((m) => [m.displayName, m.contactEmail]))).toEqual([
      [
        ["Ana", null],
        ["Pedro", "pedro@example.com"],
      ],
      [
        ["Ana", null],
        ["Luis", null],
      ],
    ]);
  });

  it("reuses 'Ana & Pedro' when Ana picks its guest again, creating and seeding nothing", async () => {
    const w = world();
    unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })));
    expect(unwrap(await w.split(byAna({ memberId: "id-3" })))).toEqual({
      spaceId: "id-1",
      created: false,
      recorded: "expense in id-1",
    });
    expect(directSpaces(w.store)).toHaveLength(1);
    expect(w.seeded).toEqual(["id-1"]);
  });

  it("takes the currency of Ana's personal space", async () => {
    const w = world({ anaCurrency: "USD" });
    unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })));
    expect(directSpaces(w.store).map((s) => s.currency)).toEqual(["USD"]);
  });

  it("refuses a new guest named like Ana and creates nothing (Review Focus 3)", async () => {
    const w = world();
    expect(codeOf(await w.split(byAna({ guest: { displayName: "ana" } })))).toBe("MemberNameTaken");
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.recorded).toEqual([]);
  });
});
