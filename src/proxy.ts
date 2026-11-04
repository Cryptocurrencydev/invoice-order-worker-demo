import { NextResponse, type NextRequest } from "next/server";

// Gives every visitor their own demo workspace so uploads, questions and orders don't collide.
export function proxy(req: NextRequest) {
  if (req.cookies.get("iow_ws")) return NextResponse.next();
  const id = `w-${crypto.randomUUID()}`;
  req.cookies.set("iow_ws", id);
  const headers = new Headers(req.headers);
  headers.set("cookie", req.cookies.toString()); // visible to this same request's server components
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set("iow_ws", id, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return res;
}

export const config = { matcher: ["/((?!_next/|samples/|docs/|favicon|icon).*)"] };
