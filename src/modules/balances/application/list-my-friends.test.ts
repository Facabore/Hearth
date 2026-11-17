import { describe, expect, it } from "vitest";
import type { SpaceMemberId } from "@/modules/spaces/application";
import { friendOrder, type Friend } from "./list-my-friends";

const friend = (spaceId: string, name: string, date: string | null): Friend => ({
  spaceId,
  currency: "COP",
  me: { memberId: "member-ana" },
  other: { memberId: `member-${spaceId}` as SpaceMemberId, kind: "USER", displayName: name, nickname: null },
  name,
  net: 0n,
  lastMovement:
    date === null ? null : { transactionId: `t-${spaceId}`, date, description: "Cena", type: "EXPENSE" },
});

describe("the order of Amigos (P338)", () => {
  it("puts the newest last movement first, then names ignoring case, and people with nothing left last", () => {
    const friends = [
      friend("s1", "luis", "2026-10-01"),
      friend("s2", "Sofi", null),
      friend("s3", "Juan", "2026-10-14"),
      friend("s4", "Ana", null),
      friend("s5", "Marta", "2026-10-01"),
    ];
    expect([...friends].sort(friendOrder).map((f) => f.name)).toEqual([
      "Juan",
      "luis",
      "Marta",
      "Ana",
      "Sofi",
    ]);
  });

  it("orders two people with the same name and date by space, so the list never reshuffles", () => {
    const friends = [friend("s2", "Juan", "2026-10-14"), friend("s1", "Juan", "2026-10-14")];
    expect([...friends].sort(friendOrder).map((f) => f.spaceId)).toEqual(["s1", "s2"]);
  });
});
