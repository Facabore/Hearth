import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categoryDto, groupDto } from "../../../../tests/support/ui/dto";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { copiedPlanDto, referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { IntlWrapper, renderWithIntl } from "../../../../tests/support/ui/render";
import { CopyNotice, rememberDropped, takeDropped } from "./copy-notice";

const groups = [
  groupDto({
    id: "g-home",
    name: "Hogar",
    categories: [
      categoryDto({ id: "c-utilities", name: "Utilities", archivedAt: "2026-11-20T12:00:00.000Z" }),
    ],
  }),
];
beforeEach(() => sessionStorage.clear());

describe("copy notice (HU-E9-08)", () => {
  it("lists the archived category dropped from Home's mapping, by name, once", async () => {
    const plan = copiedPlanDto();
    rememberDropped(plan.id, plan.dropped!);
    const first = renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Copiado del plan anterior");
    expect(notice).toHaveTextContent("Utilities, que alimentaba Home");
    expect(await axeViolations(first.container)).toEqual([]);
    first.unmount();
    renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names a savings line that was not copied", async () => {
    const plan = referencePlanDto();
    rememberDropped(plan.id, {
      mappings: [],
      savingsAccounts: [],
      lines: [{ originLineId: "l-old", name: "Car" }],
    });
    renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "La línea Car: ninguna de sus cuentas de ahorro sigue disponible",
    );
  });

  it("names the line whose savings account can no longer be used", async () => {
    const plan = copiedPlanDto();
    rememberDropped(plan.id, {
      mappings: [],
      savingsAccounts: [{ lineId: "l-savings-dec", accountId: "a-savings" }],
      lines: [],
    });
    renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Una cuenta de ahorro de Savings que ya no se puede usar",
    );
  });

  it("says the copy is complete when nothing was left out", async () => {
    const plan = copiedPlanDto();
    rememberDropped(plan.id, { mappings: [], savingsAccounts: [], lines: [] });
    renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Mismas líneas, montos, reglas y capacidades.");
    expect(notice).not.toHaveTextContent("Quedó fuera");
    expect(notice.querySelector("ul")).toBeNull();
  });

  it("shows nothing for a plan that was not copied in this tab", () => {
    renderWithIntl(<CopyNotice plan={referencePlanDto()} groups={groups} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the notice when React runs the effect twice (development)", async () => {
    const plan = copiedPlanDto();
    rememberDropped(plan.id, plan.dropped!);
    // StrictMode must sit outside the intl provider, or React does not run the effect twice.
    const Intl = IntlWrapper("es");
    render(
      <StrictMode>
        <Intl>
          <CopyNotice plan={plan} groups={groups} />
        </Intl>
      </StrictMode>,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Utilities, que alimentaba Home");
  });

  it("speaks English when the person does", async () => {
    const plan = copiedPlanDto();
    rememberDropped(plan.id, plan.dropped!);
    renderWithIntl(<CopyNotice plan={plan} groups={groups} />, { locale: "en" });
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Copied from the previous plan");
    expect(notice).toHaveTextContent("Utilities, which fed Home");
  });
});

describe("what a copy remembers (ruling P209)", () => {
  it("is gone after one read and survives storage that throws", () => {
    rememberDropped("p-x", { mappings: [], savingsAccounts: [], lines: [] });
    expect(takeDropped("p-x")).toEqual({ mappings: [], savingsAccounts: [], lines: [] });
    expect(takeDropped("p-x")).toBeNull();
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(takeDropped("p-x")).toBeNull();
    blocked.mockRestore();
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => rememberDropped("p-y", { mappings: [], savingsAccounts: [], lines: [] })).not.toThrow();
    full.mockRestore();
  });

  it("ignores text that is not a stored drop", () => {
    sessionStorage.setItem("hearth.planCopy.p-z", "not json");
    expect(takeDropped("p-z")).toBeNull();
  });
});
