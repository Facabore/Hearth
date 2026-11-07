import { cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { afterSheets, enableSheetHistory, sheetDepth } from "../navigation/sheet-gate";
import { Sheet } from "./sheet";

const settled = () => waitFor(() => expect(sheetDepth()).toBe(0));

describe("a sheet without an address of its own takes an entry of the history (ruling P307)", () => {
  beforeAll(() => enableSheetHistory());
  // Each test starts on a screen's own entry: the sheets it left open give theirs back.
  afterEach(async () => {
    cleanup();
    await settled();
  });

  it("closes on Back and keeps the screen under it", async () => {
    const onOpenChange = vi.fn();
    renderWithIntl(
      <Sheet open onOpenChange={onOpenChange} title="Nueva categoría">
        <p>Gas</p>
      </Sheet>,
    );
    expect(sheetDepth()).toBe(1);
    window.history.back();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sheetDepth()).toBe(0);
  });

  it("gives its entry back when it closes another way, so one Back then leaves the screen", async () => {
    const { rerender } = renderWithIntl(
      <Sheet open onOpenChange={() => undefined} title="Números y fechas">
        <p>1.234.567,89</p>
      </Sheet>,
    );
    expect(sheetDepth()).toBe(1);
    await userEvent.keyboard("{Escape}");
    rerender(
      <Sheet open={false} onOpenChange={() => undefined} title="Números y fechas">
        <p>1.234.567,89</p>
      </Sheet>,
    );
    await settled();
  });

  it("closes only the top sheet of two on Back", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    renderWithIntl(
      <>
        <Sheet open onOpenChange={outer} title="Editar categoría">
          <p>Arriendo</p>
        </Sheet>
        <Sheet open onOpenChange={inner} title="Ícono">
          <p>Casa</p>
        </Sheet>
      </>,
    );
    expect(sheetDepth()).toBe(2);
    window.history.back();
    await waitFor(() => expect(inner).toHaveBeenCalledWith(false));
    expect(outer).not.toHaveBeenCalled();
    expect(sheetDepth()).toBe(1);
    window.history.back();
    await waitFor(() => expect(outer).toHaveBeenCalledWith(false));
  });

  it("gives both entries back when a sheet and the sheet over it close together", async () => {
    const both = (open: boolean) => (
      <>
        <Sheet open={open} onOpenChange={() => undefined} title="Editar categoría">
          <p>Arriendo</p>
        </Sheet>
        <Sheet open={open} onOpenChange={() => undefined} title="Ícono">
          <p>Casa</p>
        </Sheet>
      </>
    );
    const { rerender } = renderWithIntl(both(true));
    expect(sheetDepth()).toBe(2);
    rerender(both(false));
    await settled();
  });

  it("takes no entry when it has an address of its own", () => {
    renderWithIntl(
      <Sheet open historyEntry={false} onOpenChange={() => undefined} title="Pan">
        <p>12.000</p>
      </Sheet>,
    );
    expect(sheetDepth()).toBe(0);
  });

  it("starts a navigation from a sheet on the screen's own entry, so the new screen never stacks on the sheet's", async () => {
    window.history.replaceState(window.history.state, "", "/spaces/personal");
    renderWithIntl(
      <Sheet open onOpenChange={() => undefined} title="Espacios">
        <p>Casa</p>
      </Sheet>,
    );
    const navigate = vi.fn(() => window.history.pushState({}, "", "/spaces/casa"));
    afterSheets(navigate);
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe("/spaces/casa");
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/personal"));
    expect(sheetDepth()).toBe(0);
  });
});
