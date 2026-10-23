import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { HOUSEHOLD_MEMBERS } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { previewOf, type AllocationDraft } from "./allocation";
import { AllocationEditor } from "./allocation-editor";

function Harness() {
  const [draft, setDraft] = useState<AllocationDraft>({ rule: "PROPORTIONAL", values: {} });
  const preview = previewOf(draft, {
    planned: "73000000",
    currency: "COP",
    members: [
      { memberId: "m-ana", capacity: "160000000" },
      { memberId: "m-juan", capacity: "240000000" },
    ],
    numberFormat: "DOT_COMMA",
  });
  return (
    <AllocationEditor
      draft={draft}
      onChange={setDraft}
      preview={preview}
      members={HOUSEHOLD_MEMBERS}
      formats={BUILT_IN_FORMATS}
      currency="COP"
      planned={cop(730_000)}
    />
  );
}

describe("allocation editor (HU-E9-08)", () => {
  it("previews 306.600 and 423.400 at 42 % / 58 %, and the 99 % sum with errors.InvalidAllocation", async () => {
    const { container } = renderWithIntl(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(screen.getByLabelText("Valor de Ana"), "42");
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "58");
    expect(normalized(screen.getByRole("group", { name: "Ana" }).textContent)).toContain("$ 306.600");
    expect(normalized(screen.getByRole("group", { name: "Juan" }).textContent)).toContain("$ 423.400");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.clear(screen.getByLabelText("Valor de Juan"));
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "57");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("El reparto de esta línea no cuadra.");
    expect(normalized(alert.textContent)).toContain("Suma: 99,00 %");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps a percent to two decimals, drops letters and shows each rule's format (#164)", async () => {
    renderWithIntl(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: "Porcentaje" }));
    const ana = screen.getByLabelText("Valor de Ana");
    expect(ana).toHaveAccessibleDescription("Ej: 42,5");
    await userEvent.type(ana, "4x2.505");
    expect(ana).toHaveValue("42,50");
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "57,5");
    expect(normalized(screen.getByRole("group", { name: "Ana" }).textContent)).toContain("$ 310.250");
    await userEvent.click(screen.getByRole("radio", { name: "Monto fijo" }));
    expect(screen.getByLabelText("Valor de Ana")).toHaveAccessibleDescription("Ej: 300.000");
  });

  it("shows no member rows when the line is left unallocated", async () => {
    renderWithIntl(<Harness />);
    expect(normalized(screen.getByRole("group", { name: "Ana" }).textContent)).toContain("$ 292.000");
    await userEvent.click(screen.getByRole("radio", { name: "Sin asignar" }));
    expect(screen.queryByRole("group", { name: "Ana" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Quién responde por la línea" })).getByText(
        /sin montos por miembro/,
      ),
    ).toBeInTheDocument();
  });
});
