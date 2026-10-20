import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import es from "@/i18n/messages/es.json";
import { ArchiveAccountButton, RestoreAccountButton } from "./account-actions";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const nequi = accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET" });
const old = accountDto({
  id: "a-old",
  name: "Old wallet",
  type: "WALLET",
  archivedAt: "2026-10-01T12:00:00.000Z",
});

describe("archive and restore accounts (HU-E9-03, ruling P131)", () => {
  it("archives after a confirmation that explains what it does", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/accounts/{accountId}/archive": () =>
        jsonResponse({ ...nequi, archivedAt: "2026-10-16T00:00:00.000Z" }),
    });
    renderWithIntl(<ArchiveAccountButton spaceId="sp-personal" account={nequi} api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Archivar Nequi" }));
    const sheet = screen.getByRole("dialog", { name: "¿Archivar Nequi?" });
    expect(sheet).toHaveAccessibleDescription(es.accounts.archive.explain);
    await userEvent.click(within(sheet).getByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal/accounts/a-nequi/archive");
  });

  it("restores an archived account", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/accounts/{accountId}/restore": () =>
        jsonResponse({ ...old, archivedAt: null }),
    });
    renderWithIntl(<RestoreAccountButton spaceId="sp-personal" account={old} api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Restaurar Old wallet" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal/accounts/a-old/restore");
  });

  it("keeps the sheet open with the problem's message when the archive is refused", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/accounts/{accountId}/archive": () =>
        problemResponse(409, "SpaceArchived"),
    });
    renderWithIntl(<ArchiveAccountButton spaceId="sp-personal" account={nequi} api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Archivar Nequi" }));
    const sheet = screen.getByRole("dialog", { name: "¿Archivar Nequi?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Archivar" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(es.errors.SpaceArchived);
    expect(screen.getByRole("dialog", { name: "¿Archivar Nequi?" })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
