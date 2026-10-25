import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChoiceGroup } from "./choice-group";

type Fruit = "apple" | "pear" | "plum" | "fig";

function Harness({
  initial = "apple",
  disabled,
  onChange,
}: {
  initial?: Fruit;
  disabled?: boolean;
  onChange?: (value: Fruit) => void;
}) {
  const [value, setValue] = useState<Fruit>(initial);
  return (
    <>
      <p id="hint">Pick one</p>
      <ChoiceGroup<Fruit>
        label="Fruit"
        value={value}
        describedBy="hint"
        disabled={disabled}
        onValueChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
        options={[
          { value: "apple", label: "Apple" },
          { value: "pear", label: "Pear" },
          { value: "plum", label: "Plum", disabled: true },
          { value: "fig", label: "Fig" },
        ]}
      />
    </>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("ChoiceGroup", () => {
  it("is a labelled radio group with the chosen option checked", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Fruit" });
    expect(group).toHaveAccessibleDescription("Pick one");
    expect(radio("Apple")).toBeChecked();
    expect(radio("Pear")).not.toBeChecked();
    expect(radio("Pear")).toHaveAttribute("value", "pear");
  });

  it("chooses an option on click", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(radio("Pear"));
    expect(onChange).toHaveBeenCalledWith("pear");
    expect(radio("Pear")).toBeChecked();
  });

  it("is one tab stop, on the chosen option", async () => {
    render(<Harness initial="pear" />);
    await userEvent.tab();
    expect(radio("Pear")).toHaveFocus();
    await userEvent.tab();
    expect(document.body).toHaveFocus();
  });

  it("moves and chooses with the arrow keys, skipping a disabled option and wrapping", async () => {
    render(<Harness initial="pear" />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(radio("Fig")).toHaveFocus();
    expect(radio("Fig")).toBeChecked();
    await userEvent.keyboard("{ArrowRight}");
    expect(radio("Apple")).toBeChecked();
    await userEvent.keyboard("{ArrowLeft}");
    expect(radio("Fig")).toBeChecked();
    await userEvent.keyboard("{ArrowUp}");
    expect(radio("Pear")).toBeChecked();
    await userEvent.keyboard("{ArrowDown}");
    expect(radio("Fig")).toBeChecked();
  });

  it("never chooses a disabled option, and a disabled group chooses nothing", async () => {
    const onChange = vi.fn();
    const { unmount } = render(<Harness onChange={onChange} />);
    expect(radio("Plum")).toBeDisabled();
    await userEvent.click(radio("Plum"));
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    render(<Harness disabled onChange={onChange} />);
    await userEvent.click(radio("Pear"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
