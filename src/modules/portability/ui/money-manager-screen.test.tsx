import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { MAX_IMPORT_BYTES, MoneyManagerScreen } from "./money-manager-screen";
import { previewFixture } from "./preview-fixture";

const UPLOAD = "POST /api/v1/spaces/{spaceId}/imports";

const renderScreen = (routes: Record<string, FakeHandler> = {}, locale: "es" | "en" = "es") => {
  const { api, requests } = fakeApi(routes);
  const onUploaded = vi.fn();
  const view = renderWithIntl(
    <MoneyManagerScreen
      backHref="/spaces/sp-personal/data"
      personal={{ id: "sp-personal", name: "Personal", currency: "COP" }}
      onUploaded={onUploaded}
      api={api}
    />,
    { locale },
  );
  return { ...view, onUploaded, requests };
};

// jsdom's FormData and File are not the ones Node's fetch sends as multipart: the browser's are, so the test uses Node's.
const NodeFormData = (
  await new Response("a=b", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData()
).constructor as typeof FormData;
beforeEach(() => vi.stubGlobal("FormData", NodeFormData));
afterEach(() => vi.unstubAllGlobals());

const backup = (name = "money_android.mmbak") => new NodeFile(["SQLite format 3"], name) as unknown as File;

describe("Importar desde Money Manager (D28, board 2)", () => {
  it("explains how to get the backup, where it goes and that it is not kept", async () => {
    const { container } = renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Desde Money Manager" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal/data");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "1En Money Manager, abre Más › Copia de seguridad.",
      "2Elige Exportar y guarda el archivo .mmbak en tu teléfono o tu computador.",
      "3Vuelve aquí y elígelo.",
    ]);
    expect(screen.getByText("Personal · COP")).toBeVisible();
    expect(screen.getByText(/no lo guardamos/)).toBeVisible();
    expect(screen.getByLabelText("Copia de Money Manager")).toHaveAttribute("accept", ".mmbak,.sqlite");
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("uploads the chosen file to the personal space as multipart, shows it is being read, and hands on the preview", async () => {
    let answer: (response: Response) => void = () => undefined;
    const sent: { space: string; type: string; body: string }[] = [];
    const { onUploaded } = renderScreen({
      [UPLOAD]: async (request, params) => {
        // The raw body: parsing it back under jsdom's globals trips undici's own checks.
        sent.push({
          space: params.spaceId!,
          type: request.headers.get("content-type") ?? "",
          body: await request.text(),
        });
        return new Promise<Response>((resolve) => (answer = resolve));
      },
    });
    await userEvent.upload(screen.getByLabelText("Copia de Money Manager"), backup());
    expect(await screen.findByRole("status")).toHaveTextContent("Leyendo money_android.mmbak…");
    expect(screen.getByRole("progressbar", { name: "Leyendo el archivo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeDisabled();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.space).toBe("sp-personal");
    expect(sent[0]!.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent[0]!.body).toMatch(/name="file"; filename="money_android.mmbak"\r\n[^]*SQLite format 3/);
    expect(sent[0]!.body).toMatch(/name="source"\r\n\r\nmoney-manager\r\n/);
    answer(jsonResponse(previewFixture(), 201));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(previewFixture()));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refuses a file over 20 MB before sending it", async () => {
    const { requests, onUploaded } = renderScreen();
    const large = backup();
    Object.defineProperty(large, "size", { value: MAX_IMPORT_BYTES + 1 });
    await userEvent.upload(screen.getByLabelText("Copia de Money Manager"), large);
    expect(await screen.findByRole("alert")).toHaveTextContent(es.errors.ImportFileTooLarge);
    expect(requests).toEqual([]);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows a refusal's message, and lets the person choose another file", async () => {
    const { onUploaded } = renderScreen({ [UPLOAD]: () => problemResponse(422, "ZipBackupNotSupported") });
    await userEvent.upload(screen.getByLabelText("Copia de Money Manager"), backup());
    expect(await screen.findByRole("alert")).toHaveTextContent(es.errors.ZipBackupNotSupported);
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeEnabled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("asks to try again in a moment when too many imports are running (429)", async () => {
    renderScreen({ [UPLOAD]: () => problemResponse(429, "TooManyRequests") });
    await userEvent.upload(screen.getByLabelText("Copia de Money Manager"), backup());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Hay muchas importaciones en curso. Intenta de nuevo en un momento.",
    );
  });

  it("words the screen in English", () => {
    renderScreen({}, "en");
    expect(screen.getByRole("heading", { level: 1, name: "From Money Manager" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeVisible();
  });
});
