import { NextResponse } from "next/server";
import { auth0, isAuth0Configured } from "./lib/auth0";

export async function proxy(request: Request) {
  if (!isAuth0Configured()) return NextResponse.next();
  return auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.svg|og.png|sitemap.xml|robots.txt).*)",
  ],
};
