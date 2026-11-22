import { can } from "@pod-stud/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/server/access";
import { frDate } from "../../common";
import { CollectifNav } from "../nav";

export const metadata: Metadata = { title: "Journal · Pod Stud" };
export const dynamic = "force-dynamic";

/** Journal des actions sensibles : suppressions, téléchargements, changements de rôle. */
export default async function Page({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { collectif: c, member: m } = await requireMember(cid, `/collectifs/${cid}/journal`);
  if (!can(m, "gerer")) redirect(`/collectifs/${cid}`);
  return (
    <>
      <h1>{c.name}</h1>
      <CollectifNav c={c} m={m} current="journal" />
      <section className="card">
        <h2>Journal des actions</h2>
        <ul className="plain" data-testid="audit">
          {[...c.audit].reverse().map((a, i) => (
            <li key={i}>
              <small className="hint">{frDate(a.at)}</small> · {a.by} · {a.what}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
