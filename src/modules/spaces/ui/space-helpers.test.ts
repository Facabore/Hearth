import { describe, expect, it } from "vitest";
import { spaceDto } from "../../../../tests/support/ui/dto";
import { activeSpaceOf, newSpaceBackHref, personalSpaceOf, spaceHomeHref } from "./space-helpers";

const personal = spaceDto();
const household = spaceDto({ id: "sp-household", name: "Household", kind: "SHARED", role: "MEMBER" });

describe("space helpers (ruling P125)", () => {
  it("finds the personal space whatever the order", () => {
    expect(personalSpaceOf([household, personal]).id).toBe("sp-personal");
  });

  it("takes the URL's space, the personal one without an id, and nothing for a space not listed", () => {
    expect(activeSpaceOf([personal, household], "sp-household")?.name).toBe("Household");
    expect(activeSpaceOf([personal, household], null)?.id).toBe("sp-personal");
    expect(activeSpaceOf([personal, household], "sp-gone")).toBeNull();
  });

  it("throws when there is no personal space, which sign-up makes impossible", () => {
    expect(() => personalSpaceOf([household])).toThrow("no personal space");
  });
});

describe("spaceHomeHref (Volver from Settings and New space)", () => {
  it("goes back to the space the person came from", () => {
    expect(spaceHomeHref([personal, household], "sp-household")).toBe("/spaces/sp-household");
  });

  it("goes to the personal space when nothing says where the person came from", () => {
    expect(spaceHomeHref([household, personal], undefined)).toBe("/spaces/sp-personal");
  });

  it("ignores a space the person does not belong to", () => {
    expect(spaceHomeHref([personal, household], "sp-stranger")).toBe("/spaces/sp-personal");
  });
});

describe("newSpaceBackHref (the fallback of Volver on the New space screen)", () => {
  it("goes back to the screen the create link started from", () => {
    expect(newSpaceBackHref([personal, household], "sp-household", "/spaces/sp-household/transactions")).toBe(
      "/spaces/sp-household/transactions",
    );
  });

  it("falls back to the home of the space when returnTo is missing or is not a same-origin path", () => {
    expect(newSpaceBackHref([personal, household], "sp-household", undefined)).toBe("/spaces/sp-household");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/\t/x", "/sign-in", ""])
      expect(newSpaceBackHref([personal, household], "sp-household", bad)).toBe("/spaces/sp-household");
  });

  it("keeps the validation of ?from= on its own: a space the person does not belong to is ignored", () => {
    expect(newSpaceBackHref([personal, household], "sp-stranger", undefined)).toBe("/spaces/sp-personal");
  });
});
