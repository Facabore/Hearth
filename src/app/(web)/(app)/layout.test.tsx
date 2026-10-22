import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { useToast } from "@/shared/ui/molecules/toast";
import SignedInLayout from "./layout";

function Saves() {
  const { show } = useToast();
  return <button onClick={() => show({ message: "Gasto guardado" })}>Guardar</button>;
}

describe("the signed-in layout (ruling P195)", () => {
  it("gives every screen under it a toast, in a status region that exists from the first render", async () => {
    renderWithIntl(
      <SignedInLayout>
        <Saves />
      </SignedInLayout>,
    );
    expect(screen.getByRole("region", { name: "Notificaciones (F8)" })).toContainElement(
      screen.getByRole("status"),
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByTestId("toast");
    expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado");
  });
});
