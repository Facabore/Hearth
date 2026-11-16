import { describe, expect, it } from "vitest";
import { accountTypeForGroup } from "./account-type-map";

describe("accountTypeForGroup (design §2.1)", () => {
  it("maps each Money Manager account group to a Hearth type", () => {
    expect(accountTypeForGroup(1, false)).toBe("BANK");
    expect(accountTypeForGroup(2, false)).toBe("CREDIT_CARD");
    expect(accountTypeForGroup(3, false)).toBe("BANK");
    expect(accountTypeForGroup(4, false)).toBe("SAVINGS");
    expect(accountTypeForGroup(6, false)).toBe("WALLET");
    expect(accountTypeForGroup(7, false)).toBe("OTHER");
    expect(accountTypeForGroup(8, false)).toBe("INVESTMENT");
    expect(accountTypeForGroup(9, false)).toBe("BANK");
    expect(accountTypeForGroup(10, false)).toBe("OTHER");
    expect(accountTypeForGroup(11, false)).toBe("CASH");
  });

  it("maps a Loan group by the sign of its balance (gap G4)", () => {
    expect(accountTypeForGroup(5, true)).toBe("LOAN");
    expect(accountTypeForGroup(5, false)).toBe("OTHER");
  });

  it("falls back to OTHER for an unknown group", () => {
    expect(accountTypeForGroup(99, false)).toBe("OTHER");
  });
});
