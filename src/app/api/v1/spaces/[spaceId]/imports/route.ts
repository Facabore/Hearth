import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { importHistoryDto, importPreviewDto } from "@/modules/portability/contracts/import.contract";
import { MAX_IMPORT_BYTES } from "@/modules/portability/application";
import { domainError, err, ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Multipart framing around the file: a request this much over the limit is refused before its body is read. */
const FRAMING_BYTES = 64 * 1024;

const tooLarge = () => err(domainError("ImportFileTooLarge", { maxBytes: MAX_IMPORT_BYTES }));
const invalid = (path: string, message: string) =>
  err(domainError("ValidationFailed", { errors: [{ path, message }] }));

/**
 * D28, design §3.2: the upload. The multipart field `file` is read into memory and handed to the import, which reads
 * it off the server's thread and never stores it (design §3.5).
 */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ request, user, params }) => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_IMPORT_BYTES + FRAMING_BYTES) return tooLarge();
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return invalid("", "Body must be multipart/form-data");
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) return invalid("file", "A file is required");
    const source = form.get("source");
    if (source !== null && source !== "money-manager") return invalid("source", "Unknown source");
    if (file.size > MAX_IMPORT_BYTES) return tooLarge();
    const result = await getContainer().portability.startImport({
      spaceId: params.spaceId!,
      userId: user!.id,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return result.ok ? ok({ status: 201, body: importPreviewDto(result.value) }) : result;
  },
});

/** D28, design §3.2: the space's import history. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().portability.listImports({
      spaceId: params.spaceId!,
      userId: user!.id,
    });
    return result.ok ? ok({ status: 200, body: importHistoryDto(result.value) }) : result;
  },
});
