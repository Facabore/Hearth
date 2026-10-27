import { NextResponse, type NextRequest } from "next/server";
import { DOCUMENT_HEADER, PATH_HEADER } from "@/shared/ui/api/server-headers";
import { hasSession } from "@/shared/ui/api/session";
import { redirectFor } from "@/shared/ui/navigation/auth-redirect";

/** HU-E9-01 (Next.js 16 `proxy.ts`): session-less requests to protected pages go to the sign-in screen. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const target = redirectFor({ pathname, search, hasSession: hasSession(request.cookies) });
  if (target) return NextResponse.redirect(new URL(target, request.url));
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, `${pathname}${search}`);
  headers.set(DOCUMENT_HEADER, request.headers.has("rsc") ? "0" : "1");
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api/|_next/|favicon.ico|robots.txt).*)"] };
