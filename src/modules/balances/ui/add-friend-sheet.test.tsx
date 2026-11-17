import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { friendDto } from "../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { AddFriendSheet } from "./add-friend-sheet";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const ANA_LOPEZ = { handle: "analopez", displayName: "Ana López" };
const REQUEST = { id: "fr-1", ...ANA_LOPEZ, createdAt: "2026-11-17T12:00:00.000Z" };

const view = (
  routes: Record<string, FakeHandler> = {},
  props: Partial<Parameters<typeof AddFriendSheet>[0]> = {},
  locale: "es" | "en" = "es",
) => {
  const fake = fakeApi(routes);
  const onOpenChange = vi.fn();
  const result = renderWithIntl(
    <AddFriendSheet
      open
      onOpenChange={onOpenChange}
      personalSpaceId="sp-personal"
      myHandle="fabian"
      api={fake.api}
      {...(props as object)}
    />,
    { locale },
  );
  return { ...fake, ...result, onOpenChange };
};

const sheet = () => screen.findByRole("dialog", { name: "Agregar amigo" });
const lookups = (requests: readonly Request[]) =>
  requests.filter((r) => r.method === "GET").map((r) => new URL(r.url).pathname);

describe('Agregar amigo (ruling P339, board "Agregar amigo · por @usuario o por nombre")', () => {
  it("finds someone only by their exact @ and sends the request, which then says it was sent", async () => {
    const { requests, container } = view({
      "GET /api/v1/users/by-handle/{handle}": (_r, { handle }) =>
        handle === "analopez" ? jsonResponse(ANA_LOPEZ) : problemResponse(404, "UserNotFound"),
      "POST /api/v1/me/friend-requests": () => jsonResponse({ ...REQUEST, status: "PENDING" }, 201),
    });
    const dialog = await sheet();
    expect(within(dialog).getByText(/Solo encuentras a alguien por su @ exacto/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Usa Hearth" }), "@AnaLopez");
    expect(await within(dialog).findByText("Ana López")).toBeInTheDocument();
    expect(within(dialog).getByText("@analopez")).toBeInTheDocument();
    // Debounced: one lookup for the whole @, never one per letter, and never a listing.
    expect(lookups(requests)).toEqual(["/api/v1/users/by-handle/analopez"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar solicitud" }));
    expect(await within(dialog).findByText("Solicitud enviada")).toBeInTheDocument();
    const post = requests.find((r) => r.method === "POST")!;
    expect(new URL(post.url).pathname).toBe("/api/v1/me/friend-requests");
    expect(await post.json()).toEqual({ handle: "analopez" });
    expect(within(dialog).queryByRole("button", { name: "Enviar solicitud" })).not.toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
    expect(await axeViolations(container.ownerDocument.body)).toEqual([]);
  });

  it("says nobody uses an @ it does not find", async () => {
    view({ "GET /api/v1/users/by-handle/{handle}": () => problemResponse(404, "UserNotFound") });
    const dialog = await sheet();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Usa Hearth" }), "nadie_aqui");
    expect(await within(dialog).findByText("No encontramos a @nadie_aqui.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Enviar solicitud" })).not.toBeInTheDocument();
  });

  it("asks to wait, in words of its own, when the lookups are throttled", async () => {
    view({ "GET /api/v1/users/by-handle/{handle}": () => problemResponse(429, "TooManyRequests") });
    const dialog = await sheet();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Usa Hearth" }), "analopez");
    expect(
      await within(dialog).findByText(
        "Hiciste muchas búsquedas seguidas. Espera un minuto y vuelve a intentarlo.",
      ),
    ).toBeInTheDocument();
    // Never the sign-in throttle's message.
    expect(within(dialog).queryByText(/volver a entrar/)).not.toBeInTheDocument();
  });

  it("never looks up the viewer's own @", async () => {
    const { requests } = view();
    const dialog = await sheet();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Usa Hearth" }), "@Fabian");
    expect(await within(dialog).findByText(/Ese @ es el tuyo/)).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it("opens the person when they had already asked the viewer: sending accepted theirs", async () => {
    view(
      {
        "GET /api/v1/users/by-handle/{handle}": () => jsonResponse(ANA_LOPEZ),
        "POST /api/v1/me/friend-requests": () =>
          jsonResponse({ ...REQUEST, status: "ACCEPTED", spaceId: "sp-ana" }),
      },
      { initialHandle: "analopez" },
    );
    const dialog = await sheet();
    expect(within(dialog).getByRole("textbox", { name: "Usa Hearth" })).toHaveValue("analopez");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Enviar solicitud" }));
    expect(await within(dialog).findByText("Ya son amigos")).toBeInTheDocument();
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/sp-personal/friends/sp-ana"));
  });

  it("adds someone who does not use Hearth by name, and opens their screen", async () => {
    const { requests, onOpenChange } = view({
      "POST /api/v1/me/friends": () =>
        jsonResponse(
          friendDto({
            spaceId: "sp-mama",
            net: { amount: "0", currency: "COP" },
            lastMovement: null,
          }),
          201,
        ),
    });
    const dialog = await sheet();
    const name = within(dialog).getByRole("textbox", { name: "No usa Hearth" });
    expect(within(dialog).getByText(/Queda como invitado/)).toBeInTheDocument();
    await userEvent.type(name, "  Mamá ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Agregar" }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/sp-personal/friends/sp-mama"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(requests).toHaveLength(1);
    expect(await requests[0]!.json()).toEqual({ displayName: "Mamá" });
  });

  it("shares the viewer's own link, and offers to pick an @ to someone without one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { unmount } = view();
    let dialog = await sheet();
    expect(within(dialog).getByText("Tú eres @fabian")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Compartir" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/f/fabian`);
    expect(await within(dialog).findByText("Copiado")).toBeInTheDocument();
    unmount();

    view({}, { myHandle: undefined });
    dialog = await sheet();
    expect(within(dialog).queryByText(/Tú eres/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Elige tu @usuario" })).toHaveAttribute(
      "href",
      "/settings?from=sp-personal",
    );
  });

  it("reads in English", async () => {
    view({}, {}, "en");
    const dialog = await screen.findByRole("dialog", { name: "Add a friend" });
    expect(within(dialog).getByRole("textbox", { name: "Uses Hearth" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Doesn't use Hearth" })).toBeInTheDocument();
  });
});
