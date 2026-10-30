import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic check only: is there a session cookie at all?
// The real session and role checks happen against the database in
// app/lib/auth.ts, inside each page and API route.
const SESSION_COOKIE = "cg_session";
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  if (!request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico)$).*)"],
};
