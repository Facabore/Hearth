import { describe, expect, it } from "vitest";
import { localDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { FixedMovements } from "../../../../tests/support/in-memory-accounts";
import { openAccount, type AccountId } from "../domain/account";
import { toView, withBalances } from "./account-view";

const today = unwrap(localDate("2026-10-17"));

/** An account carrying its own currency, so the view's rewire (D29, slice MC3) can be proved. */
const accountIn = (currency: string) =>
  unwrap(
    openAccount({
      id: "acc-1" as AccountId,
      spaceId: "space-ana",
      spaceKind: "PERSONAL",
      ownerUserId: "u-ana",
      name: "Bancolombia",
      type: "BANK",
      currency,
      openingBalance: 0n,
      now: new Date("2026-10-12T12:00:00Z"),
      siblings: [],
    }),
  );

describe("account view currency (D29, slice MC3)", () => {
  it("reads the currency from the account, not a threaded parameter", () => {
    expect(toView(accountIn("USD"), today).currency).toBe("USD");
  });

  it("gives each account's own currency through withBalances", async () => {
    const [view] = await withBalances(new FixedMovements(), [accountIn("USD")], null, today);
    expect(view!.currency).toBe("USD");
  });
});
