import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { MAX_IMPORT_BYTES } from "@/modules/portability/application";
import { importHistoryDto, importPreviewDto } from "@/modules/portability/contracts/import.contract";
import { domainError, err, ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Multipart framing around the file: the body may be this much larger than the file it carries. */
const FRAMING_BYTES = 64 * 1024;
const MAX_BODY_BYTES = MAX_IMPORT_BYTES + FRAMING_BYTES;

const tooLarge = () => err(domainError("ImportFileTooLarge", { maxBytes: MAX_IMPORT_BYTES }));
const invalid = (path: string, message: string) =>
  err(domainError("ValidationFailed", { errors: [{ path, message }] }));

/**
 * Design §3.5: the body, read chunk by chunk and abandoned as soon as it passes `limit` (null then), so a body sent
 * without a length, or with a false one, is never buffered whole.
 */
const readAtMost = async (
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
};

/**
 * D28, design §3.2, §3.5: the upload. The requester is authorized before the body is read; the body is read up to the
 * limit and no further; the multipart field `file` goes to the import, which reads it off the server's thread and never
 * stores it. The source app is detected from the file: `source`, when sent, may only name one this server reads.
 */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ request, user, params }) => {
    const portability = getContainer().portability;
    const allowed = await portability.authorizeImport({ spaceId: params.spaceId!, userId: user!.id });
    if (!allowed.ok) return allowed;
    if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return tooLarge();
    // The whole upload holds a slot, from the first byte read to the preview: a burst of uploads is refused before any
    // of its bodies is buffered, not only once their reads reach the worker.
    if (uploadsInFlight >= MAX_UPLOADS_IN_FLIGHT) return err(domainError("TooManyRequests"));
    uploadsInFlight += 1;
    try {
      return await readAndStart(request, portability, params.spaceId!, user!.id);
    } finally {
      uploadsInFlight -= 1;
    }
  },
});

/** Design §3.5: uploads read at once by this server process, the same bound as the reader's workers. */
const MAX_UPLOADS_IN_FLIGHT = 2;
let uploadsInFlight = 0;

const readAndStart = async (
  request: Request,
  portability: ReturnType<typeof getContainer>["portability"],
  spaceId: string,
  userId: string,
) => {
  {
    const body = await readAtMost(request.body, MAX_BODY_BYTES);
    if (body === null) return tooLarge();
    let form: FormData;
    try {
      const contentType = request.headers.get("content-type") ?? "";
      form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    } catch {
      return invalid("", "Body must be multipart/form-data");
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) return invalid("file", "A file is required");
    const source = form.get("source");
    if (source !== null && source !== "money-manager") return invalid("source", "Unknown source");
    if (file.size > MAX_IMPORT_BYTES) return tooLarge();
    const result = await portability.startImport({
      spaceId,
      userId,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return result.ok ? ok({ status: 201, body: importPreviewDto(result.value) }) : result;
  }
};

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
