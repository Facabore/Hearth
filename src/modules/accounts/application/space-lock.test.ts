import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  fakeSpaceAccess,
  fixedTimeZones,
  memoryTm,
  membership,
  money,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";
import { createUpdateAccount } from "./update-account";

/**
 * Issue #245: creating and editing an account take the space lock before they read the membership, so a currency
 * change in progress is waited for and the currency it commits is the one they read.
 */
const setup = () => {
  const events: string[] = [];
  const base = fakeSpaceAccess(membership());
  const deps: AccountsDeps = {
    accounts: new InMemoryAccounts(),
    access: async (spaceId, userId, options) => {
      events.push(`access ${spaceId}`);
      return base(spaceId, userId, options);
    },
    spaceLocks: {
      lockForMoneyWrite: async (spaceId) => {
        events.push(`lock ${spaceId}`);
      },
    },
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(new Date("2026-11-02T12:00:00Z")),
    userTimeZones: fixedTimeZones(),
    tm: memoryTm,
  };
  return { deps, events };
};

const own = { spaceId: "space-ana", userId: "u-ana" };

describe("the space lock of account writes (issue #245)", () => {
  it("takes it before CreateAccount reads the membership", async () => {
    const { deps, events } = setup();
    unwrap(
      await createCreateAccount(deps)({ ...own, name: "Nequi", type: "WALLET", openingBalance: money(0n) }),
    );
    expect(events).toEqual(["lock space-ana", "access space-ana"]);
  });

  it("takes it before UpdateAccount reads the membership", async () => {
    const { deps, events } = setup();
    const created = unwrap(
      await createCreateAccount(deps)({ ...own, name: "Nequi", type: "WALLET", openingBalance: money(0n) }),
    );
    events.length = 0;
    unwrap(
      await createUpdateAccount(deps)({ ...own, accountId: created.id, changes: { name: "Daviplata" } }),
    );
    expect(events).toEqual(["lock space-ana", "access space-ana"]);
  });
});
