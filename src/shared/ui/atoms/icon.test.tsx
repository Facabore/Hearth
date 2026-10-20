import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SYMBOL_PATHS } from "../icons/symbols";
import { UI_ICONS } from "../icons/ui-icons";
import { Icon, SymbolIcon } from "./icon";

describe("Icon and SymbolIcon", () => {
  it("draws a decorative stroke icon from the registry", () => {
    const { container } = render(
      <>
        <Icon name="back" />
        <SymbolIcon name="cart" size={20} />
      </>,
    );
    const [back, cart] = [...container.querySelectorAll("svg")];
    expect(back).toHaveAttribute("aria-hidden", "true");
    expect(back?.querySelector("path")).toHaveAttribute("d", UI_ICONS.back);
    expect(cart).toHaveAttribute("width", "20");
    expect(cart?.querySelector("path")).toHaveAttribute("d", SYMBOL_PATHS.cart);
  });
});
