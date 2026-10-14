import { describe, expect, it } from "vitest";
import { domainError, err, FixedClock, ok, type TransactionManager } from "@/shared/kernel";
import { codeOf, memoryTm, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createDirectSpace } from "../domain/direct-space";
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
    /** Run in a transaction that, like PostgreSQL's, undoes what the work stored when it answers an Err. */
    rollback?: boolean;
    /** Seeding stores its marker and then fails with this error code. */
    seedError?: string;
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
  // What each rolled-back transaction was about to discard, so "nothing remains" cannot pass vacuously.
  const rolledBack: { code: string; directSpaces: string[]; seeded: string[] }[] = [];
  // Undoes the spaces, seeded ids and records; the pair keys are private to the store, so rollback tests use guests.
  const rollingBack: TransactionManager = {
    run: async (work) => {
      const before = { spaces: [...store.spaces], seeded: [...seeded], recorded: [...recorded] };
      const result = await work();
      if (!result.ok) {
        const direct = store.spaces.filter((s) => s.kind === "DIRECT");
        rolledBack.push({
          code: result.error.code,
          directSpaces: direct.map((s) => s.id),
          seeded: [...seeded],
        });
        store.spaces = before.spaces;
        seeded.splice(0, seeded.length, ...before.seeded);
        recorded.splice(0, recorded.length, ...before.recorded);
      }
      return result;
    },
  };
  const split = createSplitWithPerson<string, string>({
    access: createSpaceAccess(store),
    spaces: store,
    direct: store,
    onCreated: async (space) => {
      seeded.push(space.id);
      return options.seedError ? err(domainError(options.seedError)) : ok(undefined);
    },
    recordExpense:
      options.recordExpense ??
      (async (input) => {
        recorded.push(input);
        return ok(`expense in ${input.spaceId}`);
      }),
    ids: sequentialIds("id"),
    clock: new FixedClock(now),
    tm: options.rollback ? rollingBack : memoryTm,
  });
  return { store, seeded, recorded, rolledBack, split };
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

describe("SplitWithPerson with registered people and invalid counterparts (HU-E1-13)", () => {
  it("creates 'Ana & Juan' with both as OWNER from Juan's place in Household, and Juan's split reuses it", async () => {
    const w = world();
    expect(unwrap(await w.split(byAna({ memberId: "member-juan" })))).toMatchObject({
      spaceId: "id-1",
      created: true,
    });
    expect(directSpaces(w.store).map((s) => [s.name, s.members.map((m) => [m.userId, m.role])])).toEqual([
      [
        "Ana & Juan",
        [
          ["u-ana", "OWNER"],
          ["u-juan", "OWNER"],
        ],
      ],
    ]);
    const byJuan = {
      userId: "u-juan",
      userName: "Juan",
      locale: "es",
      counterpart: { memberId: "member-ana" },
      expense: "Taxi",
    };
    expect(unwrap(await w.split(byJuan))).toEqual({
      spaceId: "id-1",
      created: false,
      recorded: "expense in id-1",
    });
  });

  it("answers MemberNotFound for someone Ana shares no space with and for unknown or malformed ids (Review Focus 3)", async () => {
    const w = world();
    for (const memberId of ["member-marta", "member-nobody", "not-a-uuid"]) {
      expect(codeOf(await w.split(byAna({ memberId })))).toBe("MemberNotFound");
    }
    expect(directSpaces(w.store)).toEqual([]);
  });

  it("refuses splitting with herself or with a guest of a shared space (Review Focus 3)", async () => {
    const w = world();
    expect(codeOf(await w.split(byAna({ memberId: "member-ana" })))).toBe("InvalidDirectCounterpart");
    expect(codeOf(await w.split(byAna({ memberId: "member-pedro" })))).toBe("InvalidDirectCounterpart");
    expect(w.recorded).toEqual([]);
  });

  it("answers MemberNotFound for a member who left the shared space (Review Focus 3)", async () => {
    const w = world();
    expect(await w.store.markLeft("space-household", "member-juan", "USER", now)).toBe(true);
    expect(codeOf(await w.split(byAna({ memberId: "member-juan" })))).toBe("MemberNotFound");
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.seeded).toEqual([]);
    expect(w.recorded).toEqual([]);
  });

  it("answers MemberNotFound for a member of a space Ana has since left (Review Focus 3)", async () => {
    const w = world();
    expect(await w.store.markLeft("space-household", "member-ana", "USER", now)).toBe(true);
    expect(codeOf(await w.split(byAna({ memberId: "member-juan" })))).toBe("MemberNotFound");
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.seeded).toEqual([]);
    expect(w.recorded).toEqual([]);
  });

  it("reuses 'Ana & Juan' for every later split with Juan, from either side, without creating a second", async () => {
    class CountingStore extends InMemorySpaceStore {
      addDirectCalls = 0;
      override async addDirect(space: Space): Promise<SpaceId> {
        this.addDirectCalls += 1;
        return super.addDirect(space);
      }
    }
    const store = new CountingStore();
    const w = world({ store });
    const fromJuan = {
      userId: "u-juan",
      userName: "Juan",
      locale: "es",
      counterpart: { memberId: "member-ana" },
      expense: "Taxi",
    };
    const results = [
      unwrap(await w.split(byAna({ memberId: "member-juan" }))),
      unwrap(await w.split(byAna({ memberId: "member-juan" }))),
      unwrap(await w.split(fromJuan)),
    ];
    expect(results.map((r) => [r.spaceId, r.created])).toEqual([
      ["id-1", true],
      ["id-1", false],
      ["id-1", false],
    ]);
    expect(directSpaces(store)).toHaveLength(1);
    expect(store.addDirectCalls).toBe(1);
    expect(w.seeded).toEqual(["id-1"]);
    expect(w.recorded.map((r) => r.spaceId)).toEqual(["id-1", "id-1", "id-1"]);
  });

  it("uses the direct space Juan is picked in even when it holds no pair key (claimed while the pair had another)", async () => {
    const w = world();
    w.store.seed(
      unwrap(
        createDirectSpace({
          id: "space-claimed" as SpaceId,
          creatorMemberId: "member-claimed-ana" as SpaceMemberId,
          counterpartMemberId: "member-claimed-juan" as SpaceMemberId,
          creatorUserId: "u-ana",
          creatorName: "Ana",
          counterpart: { kind: "USER", userId: "u-juan", displayName: "Juan" },
          currency: "COP",
          now,
        }),
      ),
    );
    expect(unwrap(await w.split(byAna({ memberId: "member-claimed-juan" })))).toEqual({
      spaceId: "space-claimed",
      created: false,
      recorded: "expense in space-claimed",
    });
    expect(directSpaces(w.store).map((s) => s.id)).toEqual(["space-claimed"]);
    expect(w.seeded).toEqual([]);
  });

  it("refuses a new guest without a usable name and creates nothing", async () => {
    const w = world();
    expect(codeOf(await w.split(byAna({ guest: { displayName: "   " } })))).toBe("InvalidMemberName");
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.seeded).toEqual([]);
    expect(w.recorded).toEqual([]);
  });

  it("refuses a currency the platform does not know, taken from Ana's personal space, and creates nothing", async () => {
    const w = world({ anaCurrency: "ZZZ" });
    expect(codeOf(await w.split(byAna({ guest: { displayName: "Pedro" } })))).toBe("UnknownCurrency");
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.seeded).toEqual([]);
    expect(w.recorded).toEqual([]);
  });

  it("records in the direct space a concurrent first split created meanwhile (Review Focus 5)", async () => {
    const rival = unwrap(
      createDirectSpace({
        id: "space-rival" as SpaceId,
        creatorMemberId: "member-rival-juan" as SpaceMemberId,
        counterpartMemberId: "member-rival-ana" as SpaceMemberId,
        creatorUserId: "u-juan",
        creatorName: "Juan",
        counterpart: { kind: "USER", userId: "u-ana", displayName: "Ana" },
        currency: "COP",
        now,
      }),
    );
    class RacingStore extends InMemorySpaceStore {
      override async addDirect(space: Space): Promise<SpaceId> {
        await super.addDirect(rival);
        return super.addDirect(space);
      }
    }
    const w = world({ store: new RacingStore() });
    expect(unwrap(await w.split(byAna({ memberId: "member-juan" })))).toEqual({
      spaceId: "space-rival",
      created: false,
      recorded: "expense in space-rival",
    });
    expect(directSpaces(w.store).map((s) => s.id)).toEqual(["space-rival"]);
    expect(w.seeded).toEqual([]);
  });

  it("passes the recorder's error on", async () => {
    const w = world({ recordExpense: async () => err(domainError("CategoryNotFound")) });
    expect(codeOf(await w.split(byAna({ guest: { displayName: "Pedro" } })))).toBe("CategoryNotFound");
  });
});

describe("SplitWithPerson is one transaction (HU-E1-13, Review Focus 3)", () => {
  it("rolls back the new direct space and its seeded categories when the recorder refuses the expense", async () => {
    const w = world({ rollback: true, recordExpense: async () => err(domainError("CategoryNotFound")) });
    expect(codeOf(await w.split(byAna({ guest: { displayName: "Pedro" } })))).toBe("CategoryNotFound");
    // The transaction discarded a space that existed, seeded, when the recorder answered ...
    expect(w.rolledBack).toEqual([{ code: "CategoryNotFound", directSpaces: ["id-1"], seeded: ["id-1"] }]);
    // ... and nothing of it remains.
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.seeded).toEqual([]);
  });

  it("rolls back the new direct space and what was seeded when seeding fails, and records nothing", async () => {
    const w = world({ rollback: true, seedError: "CategoryNameTaken" });
    expect(codeOf(await w.split(byAna({ guest: { displayName: "Pedro" } })))).toBe("CategoryNameTaken");
    expect(w.rolledBack).toEqual([{ code: "CategoryNameTaken", directSpaces: ["id-1"], seeded: ["id-1"] }]);
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.seeded).toEqual([]);
    expect(w.recorded).toEqual([]);
  });

  it("keeps the new direct space, its seeded categories and the expense when nothing fails", async () => {
    const w = world({ rollback: true });
    unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })));
    expect(w.rolledBack).toEqual([]);
    expect(directSpaces(w.store).map((s) => s.id)).toEqual(["id-1"]);
    expect(w.seeded).toEqual(["id-1"]);
    expect(w.recorded).toHaveLength(1);
  });
});
