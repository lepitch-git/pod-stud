import { getCollectif, visualKey } from "@/lib/server/db";
import { getStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Visuel d'une émission (pochette, affichée aussi aux invités). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cid: string; eid: string }> },
) {
  const { cid, eid } = await params;
  const e = (await getCollectif(cid))?.emissions.find((x) => x.id === eid);
  const data = e?.imageType ? await getStore().get(visualKey(cid, eid)) : null;
  if (!e || !data) return new Response("Visuel introuvable", { status: 404 });
  return new Response(new Blob([data as Uint8Array<ArrayBuffer>]), {
    headers: {
      "content-type": e.imageType as string,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
