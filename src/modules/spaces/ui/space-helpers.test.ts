import { describe, expect, it } from "vitest";
import { spaceDto } from "../../../../tests/support/ui/dto";
import { activeSpaceOf, personalSpaceOf, spaceHomeHref } from "./space-helpers";

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
