import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { TOAST_ACTION_MS, TOAST_MS, useToast, type ToastInput } from "./toast";
import { ToastProvider } from "./toast-provider";

// Fake timers make findBy* give up before a real module import settles: load the toast host once, up front.
beforeAll(() => import("./toast-host"));
beforeEach(() => {
  vi.useFakeTimers();
  // Testing Library advances Jest's fake clock after each async helper and hangs on Vitest's: tell it how.
  vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Trigger({ toast, label = "Mostrar" }: { readonly toast: ToastInput; readonly label?: string }) {
  const { show } = useToast();
  return <button onClick={() => show(toast)}>{label}</button>;
}
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
/** The card is a lazily loaded chunk: it exists once the import resolves, so it is awaited, never assumed. */
const open = async (u: ReturnType<typeof user>, name = "Mostrar") => {
  await u.click(screen.getByRole("button", { name }));
  await screen.findByTestId("toast");
};
const withProvider = (toast: ToastInput) =>
  renderWithIntl(
    <ToastProvider>
      <Trigger toast={toast} />
    </ToastProvider>,
  );

describe("Toast (ruling P195)", () => {
  it("speaks a success in a status region that existed before the message (WCAG 4.1.3)", async () => {
    const { container } = withProvider({ message: "Gasto guardado" });
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole("region", { name: "Notificaciones (F8)" })).toContainElement(status);
    await open(user());
    expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado");
    expect(screen.getByRole("button", { name: "Mostrar" })).toHaveFocus();
    // axe waits on real timers; the toast stays on screen because its own timer was a fake one.
    vi.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("puts a failure in the alert region", async () => {
    withProvider({ message: "No se pudo deshacer", tone: "alert" });
    await open(user());
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo deshacer");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("hides a plain message after 5 s and one with an action after 8 s", async () => {
    const { unmount } = withProvider({ message: "Gasto guardado" });
    await open(user());
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    unmount();
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction: () => {} } });
    await open(user());
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS - 1));
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("pauses while the pointer is on it or focus is inside it (WCAG 2.2.1)", async () => {
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction: () => {} } });
    const u = user();
    await open(u);
    await u.hover(screen.getByTestId("toast"));
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS * 3));
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    await u.unhover(screen.getByTestId("toast"));
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS));
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("stays while focus is inside it and goes after the focus leaves (WCAG 2.2.1)", async () => {
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction: () => {} } });
    const u = user();
    await open(u);
    await u.keyboard("{F8}");
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS * 3));
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    await u.click(document.body);
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS));
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("does not hand the hold of the pointer on one toast to the toast that replaces it", async () => {
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction: () => {} } });
    const u = user();
    await open(u);
    await u.hover(screen.getByTestId("toast"));
    await u.keyboard("{Enter}");
    await u.keyboard("{F8}");
    await u.click(document.body);
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS));
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("runs the action once and closes; Escape, the close button and F8 work from the keyboard", async () => {
    const onAction = vi.fn();
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction } });
    const u = user();
    await open(u);
    await u.keyboard("{F8}");
    expect(screen.getByTestId("toast")).toHaveFocus();
    await u.dblClick(screen.getByRole("button", { name: "Deshacer" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await open(u);
    await u.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await open(u);
    await u.keyboard("{F8}{Escape}");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("replaces the current toast with a new one", async () => {
    renderWithIntl(
      <ToastProvider>
        <Trigger toast={{ message: "Gasto guardado" }} label="Uno" />
        <Trigger toast={{ message: "Cambios guardados" }} label="Dos" />
      </ToastProvider>,
    );
    const u = user();
    await open(u, "Uno");
    await u.click(screen.getByRole("button", { name: "Dos" }));
    await screen.findByText("Cambios guardados");
    expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados");
    expect(screen.getByRole("status")).not.toHaveTextContent("Gasto guardado");
  });

  it("sits above the bottom navigation and the safe area, under the sheets", () => {
    withProvider({ message: "x" });
    const region = screen.getByRole("region", { name: "Notificaciones (F8)" });
    expect(region).toHaveClass(
      "fixed",
      "z-40",
      "bottom-[calc(76px+env(safe-area-inset-bottom)+0.5rem)]",
      "lg:bottom-4",
    );
  });

  it("does nothing outside a provider, so screens without one render as before", async () => {
    renderWithIntl(<Trigger toast={{ message: "Gasto guardado" }} />);
    await user().click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
