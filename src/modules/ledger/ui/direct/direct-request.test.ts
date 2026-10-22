import { describe, expect, it } from "vitest";
import { categoryDto, groupDto } from "../../../../../tests/support/ui/dto";
import { categoryKeyOf, directBodyOf } from "./direct-request";

const groups = [
  groupDto({
    categories: [
      categoryDto({
        id: "c-food",
        key: "restaurants",
        subcategories: [categoryDto({ id: "c-sushi", key: null, parentCategoryId: "c-food" })],
      }),
      categoryDto({ id: "c-mine", key: null }),
    ],
  }),
];

describe("direct split request (HU-E1-13, ruling P172)", () => {
  it("names the category by its catalog key, the subcategory's or else its parent's, and none for a person's own", () => {
    expect(categoryKeyOf(groups, { categoryId: "c-food", subcategoryId: "c-sushi" })).toBe("restaurants");
    expect(categoryKeyOf(groups, { categoryId: "c-food", subcategoryId: null })).toBe("restaurants");
    expect(categoryKeyOf(groups, { categoryId: "c-mine", subcategoryId: null })).toBeNull();
    expect(categoryKeyOf(groups, null)).toBeNull();
  });

  it("uses the subcategory's own key when it has one", () => {
    const own = [
      groupDto({
        categories: [
          categoryDto({
            id: "c-food",
            key: "restaurants",
            subcategories: [categoryDto({ id: "c-sushi", key: "sushi", parentCategoryId: "c-food" })],
          }),
        ],
      }),
    ];
    expect(categoryKeyOf(own, { categoryId: "c-food", subcategoryId: "c-sushi" })).toBe("sushi");
  });

  it("sends the expense with the counterpart and the key instead of the category id", () => {
    const body = {
      description: "Cena",
      date: "2026-10-31",
      occurredAt: "x",
      timeZone: "America/Bogota",
      categoryId: "c-food",
      amount: { amount: "12000000", currency: "COP" },
      accountId: "a-bank",
    };
    expect(directBodyOf(body, { kind: "MEMBER", memberId: "m-juan-d", name: "Juan" }, "restaurants")).toEqual(
      {
        description: "Cena",
        date: "2026-10-31",
        occurredAt: "x",
        timeZone: "America/Bogota",
        amount: { amount: "12000000", currency: "COP" },
        accountId: "a-bank",
        counterpart: { kind: "MEMBER", memberId: "m-juan-d" },
        categoryKey: "restaurants",
      },
    );
    expect(directBodyOf(body, { kind: "GUEST", displayName: " Marta " }, "restaurants").counterpart).toEqual({
      kind: "GUEST",
      displayName: "Marta",
    });
  });
});
