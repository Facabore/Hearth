import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ToastProvider } from "./toast-provider";
import { useToast } from "./toast";

// The factory runs when the card's module is first imported, never before: it counts the loads.
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./toast-host", async (importOriginal) => {
  loads.count += 1;
  return importOriginal();
});

function Saves() {
  const { show } = useToast();
  return <button onClick={() => show({ message: "Gasto guardado" })}>Guardar</button>;
}

describe("the toast card loads with the first toast only (ruling P198)", () => {
  it("renders the live regions at once and fetches the card, its buttons and its timer on the first show", async () => {
    renderWithIntl(
      <ToastProvider>
        <Saves />
      </ToastProvider>,
    );
    // Every signed-in route pays for these two regions and the provider, not for the card.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(loads.count).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByTestId("toast")).toHaveTextContent("Gasto guardado");
    expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado");
    expect(loads.count).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(loads.count).toBe(1);
  });
});
