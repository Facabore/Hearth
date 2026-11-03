import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { accountDto, guestDto, memberDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { initialSplitDraft, type SharedExpenseContext } from "./shared-context";
import { SharedFields } from "./shared-fields";
import type { SplitDraft } from "./split-request";

const CONTEXT: SharedExpenseContext = {
  members: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" })],
  meMemberId: "m-ana",
  myAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" })],
  funds: [],
};
const START: SplitDraft = {
  payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
  method: "EQUAL",
  selected: ["m-ana", "m-juan"],
  values: {},
  chosen: false,
};

function Harness({
  api,
  amount,
  seen,
  context = CONTEXT,
  initial = START,
}: {
  api: Api;
  amount: string;
  seen: (draft: SplitDraft) => void;
  context?: SharedExpenseContext;
  initial?: SplitDraft;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <SharedFields
      context={context}
      draft={draft}
      onChange={(next) => {
        seen(next);
        setDraft(next);
      }}
      amount={amount}
      currency="COP"
      formats={BUILT_IN_FORMATS}
      title="Mercado · Household"
      spaceId="sp-household"
      categoryId="c-groceries"
      date="2026-11-08"
      api={api}
    />
  );
}

describe("the plan's split when the preview refuses the amount (ruling P285)", () => {
  it("goes back to equal parts among every member when the preview answers 422 InvalidSplit", async () => {
    // Home's 40 % / 60 % for 2,000,000 COP; one minor unit leaves a member with nothing, which recording refuses too.
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (request) =>
        new URL(request.url).searchParams.get("amount") === "1"
          ? problemResponse(422, "InvalidSplit")
          : jsonResponse({
              method: "BY_ALLOCATION",
              availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
              lineId: "l-home",
              shares: [
                { memberId: "m-ana", amount: { amount: "80000000", currency: "COP" } },
                { memberId: "m-juan", amount: { amount: "120000000", currency: "COP" } },
              ],
            }),
    });
    const drafts: SplitDraft[] = [];
    const seen = (draft: SplitDraft) => drafts.push(draft);
    const { rerender } = renderWithIntl(<Harness api={api} amount="200000000" seen={seen} />);
    await waitFor(() => expect(drafts.at(-1)?.method).toBe("BY_ALLOCATION"));
    rerender(<Harness api={api} amount="1" seen={seen} />);
    await waitFor(() =>
      expect(drafts.at(-1)).toMatchObject({ method: "EQUAL", selected: ["m-ana", "m-juan"], chosen: false }),
    );
    expect(requests.map((r) => new URL(r.url).searchParams.get("amount"))).toEqual(["200000000", "1"]);
  });
});

describe("a VIEWER in the split (ruling P293)", () => {
  // Hogar as board E9-06 draws it: Ana, Juan and the guest Pedro share; Sofi only reads.
  const HOGAR: SharedExpenseContext = {
    ...CONTEXT,
    members: [
      ...CONTEXT.members,
      memberDto({ id: "m-sofi", userId: "u-sofi", displayName: "Sofi", role: "VIEWER" }),
      guestDto(),
    ],
  };
  const OUTSIDE_THE_PLAN = ["m-ana", "m-juan", "m-pedro"];

  it("starts with every member but the VIEWER Sofi ticked, the guest Pedro included, and the sheet still offers her", async () => {
    const user = userEvent.setup();
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () =>
        jsonResponse({
          method: "EQUAL",
          availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
          lineId: null,
          shares: OUTSIDE_THE_PLAN.map((memberId) => ({
            memberId,
            amount: { amount: "3000000", currency: "COP" },
          })),
        }),
    });
    const drafts: SplitDraft[] = [];
    renderWithIntl(
      <Harness
        api={api}
        amount="9000000"
        seen={(draft) => drafts.push(draft)}
        context={HOGAR}
        initial={initialSplitDraft(HOGAR)}
      />,
    );
    const row = screen.getByRole("button", { name: /División/ });
    expect(row).toHaveTextContent("Con 3 personas · partes iguales");
    await user.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Quién pagó y para quién" });
    expect(within(sheet).getByRole("checkbox", { name: "Juan" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: /Pedro/ })).toBeChecked();
    const sofi = within(sheet).getByRole("checkbox", { name: "Sofi" });
    expect(sofi).not.toBeChecked();
    // Whoever records can still add her by hand, if she really took part in the expense.
    await user.click(sofi);
    expect(sofi).toBeChecked();
    expect(drafts.at(-1)).toMatchObject({
      method: "EQUAL",
      selected: ["m-ana", "m-juan", "m-sofi", "m-pedro"],
      chosen: true,
    });
  });

  it("goes back to equal parts without the VIEWER Sofi when the plan's split no longer applies", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (request) =>
        new URL(request.url).searchParams.get("amount") === "1"
          ? problemResponse(422, "InvalidSplit")
          : jsonResponse({
              method: "BY_ALLOCATION",
              availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
              lineId: "l-home",
              shares: [
                { memberId: "m-ana", amount: { amount: "80000000", currency: "COP" } },
                { memberId: "m-juan", amount: { amount: "120000000", currency: "COP" } },
              ],
            }),
    });
    const drafts: SplitDraft[] = [];
    const seen = (draft: SplitDraft) => drafts.push(draft);
    const initial = initialSplitDraft(HOGAR);
    const { rerender } = renderWithIntl(
      <Harness api={api} amount="200000000" seen={seen} context={HOGAR} initial={initial} />,
    );
    await waitFor(() => expect(drafts.at(-1)?.method).toBe("BY_ALLOCATION"));
    rerender(<Harness api={api} amount="1" seen={seen} context={HOGAR} initial={initial} />);
    await waitFor(() =>
      expect(drafts.at(-1)).toMatchObject({ method: "EQUAL", selected: OUTSIDE_THE_PLAN, chosen: false }),
    );
  });
});
