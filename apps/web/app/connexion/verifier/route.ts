import { NextResponse } from "next/server";
import { safeNext, setSessionCookie, verify, type LoginToken } from "@/lib/server/auth";
import { getOrCreateUser } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Arrivée par le lien de connexion reçu par e-mail. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const t = verify<LoginToken>(url.searchParams.get("jeton"));
  if (!t || t.purpose !== "connexion")
    return NextResponse.redirect(new URL("/lien/connexion", req.url));
  const user = await getOrCreateUser(t.email);
  await setSessionCookie(user.id);
  return NextResponse.redirect(new URL(safeNext(t.next), req.url));
}
