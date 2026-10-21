import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { AccountPicker } from "./account-picker";

const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia", institution: "Bancolombia" }),
  accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET", icon: "wallet" }),
  accountDto({ id: "a-old", name: "Old wallet", type: "WALLET", archivedAt: "2026-10-01T12:00:00.000Z" }),
];

describe("account picker (HU-E9-03)", () => {
  it("offers only active accounts and chooses one", async () => {
    const onChoose = vi.fn();
    const onOpenChange = vi.fn();
    renderWithIntl(
      <AccountPicker
        open
        onOpenChange={onOpenChange}
        accounts={accounts}
        value="a-bank"
        onChoose={onChoose}
        label="Cuenta"
      />,
    );
    const sheet = screen.getByRole("dialog", { name: "Cuenta" });
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual([expect.stringContaining("Bancolombia"), expect.stringContaining("Nequi")]);
    expect(within(sheet).queryByRole("radio", { name: /Old wallet/ })).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Nequi/ }));
    expect(onChoose).toHaveBeenLastCalledWith("a-nequi");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("closes when the account already chosen is tapped again", async () => {
    const onOpenChange = vi.fn();
    renderWithIntl(
      <AccountPicker
        open
        onOpenChange={onOpenChange}
        accounts={accounts}
        value="a-bank"
        onChoose={vi.fn()}
        label="Cuenta"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /Bancolombia/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
