import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default auth(function middleware(req) {
  const { nextUrl, auth: session } = req as NextRequest & { auth: { user?: unknown } | null };

  // Already authenticated → let through
  if (session?.user) return NextResponse.next();

  // Redirect to /login, preserving the original destination as callbackUrl
  const loginUrl = new URL("/login", nextUrl);
  loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  // Match everything except:
  //   /login         — the sign-in page itself
  //   /api/auth/*    — NextAuth callback & CSRF endpoints
  //   /_next/*       — Next.js static assets
  //   /favicon.ico   — browser icon request
  //   /manifest.json — PWA manifest
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico|manifest\\.json|icons).*)",
  ],
};
