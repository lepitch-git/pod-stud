import { can, INVITE_DAYS, linkState, roleLabel, ROLES, type Role } from "@pod-stud/shared";
import type { Metadata } from "next";
import { requireMember } from "@/lib/server/access";
import { siteOrigin } from "@/lib/server/auth";
import type { Collectif, Member } from "@/lib/server/db";
import { testMode } from "@/lib/server/mail";
import { changeMember, inviteMember, removeMember, revokeMemberInvite } from "../../actions";
import { ErrorBanner, frDay } from "../../common";
import { ConfirmSubmit, CopyButton } from "../../ui";
import { CollectifNav } from "../nav";

export const metadata: Metadata = { title: "Membres · Pod Stud" };
export const dynamic = "force-dynamic";

const LINK_LABEL = {
  valide: "en attente",
  revoque: "révoquée",
  expire: "expirée",
  utilise: "acceptée",
};

function EmissionChoice({
  c,
  scope,
  prefix,
}: {
  c: Collectif;
  scope?: Member["emissions"];
  prefix: string;
}) {
  return (
    <fieldset className="choices">
      <legend>Émissions (pour Animateur et Monteur)</legend>
      <label className="radio-line">
        <input type="checkbox" name="toutes" value="1" defaultChecked={!scope || scope === "*"} />
        Toutes, y compris les futures
      </label>
      {c.emissions.map((e) => (
        <label className="radio-line" key={e.id}>
          <input
            type="checkbox"
            name="emissions"
            value={e.id}
            defaultChecked={Array.isArray(scope) && scope.includes(e.id)}
            data-testid={`${prefix}-emission`}
          />
          {e.name}
        </label>
      ))}
    </fieldset>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ cid: string }>;
  searchParams: Promise<{ erreur?: string; invite?: string }>;
}) {
  const { cid } = await params;
  const { erreur, invite } = await searchParams;
  const { collectif: c, member: me, user } = await requireMember(cid, `/collectifs/${cid}/membres`);
  const manage = can(me, "gerer");
  const origin = await siteOrigin();
  const scopeLabel = (m: Member) =>
    m.role === "proprietaire" || m.role === "admin" || m.emissions === "*"
      ? "toutes les émissions"
      : c.emissions
          .filter((e) => (m.emissions as string[]).includes(e.id))
          .map((e) => e.name)
          .join(", ") || "aucune émission";
  return (
    <>
      <h1>{c.name}</h1>
      <CollectifNav c={c} m={me} current="membres" />
      <ErrorBanner message={erreur} />
      {invite && (
        <p className="info-box" data-testid="invite-done">
          Invitation créée.{" "}
          {testMode()
            ? "Mode test : l'e-mail ne part pas, copiez le lien ci-dessous et envoyez-le vous-même."
            : "Un e-mail vient de partir ; vous pouvez aussi copier le lien ci-dessous."}
        </p>
      )}
      <section className="card">
        <h2>Membres</h2>
        <table className="list" data-testid="members">
          <thead>
            <tr>
              <th>Membre</th>
              <th>Rôle</th>
              <th>Accès</th>
              {manage && <th />}
            </tr>
          </thead>
          <tbody>
            {c.members.map((m) => (
              <tr key={m.userId} data-testid="member" data-email={m.email}>
                <td>
                  {m.name || m.email}
                  <br />
                  <small className="hint">{m.email}</small>
                </td>
                <td data-testid="member-role">{roleLabel(m.role)}</td>
                <td>{scopeLabel(m)}</td>
                {manage && (
                  <td>
                    {m.userId !== user.id &&
                      (m.role !== "proprietaire" || me.role === "proprietaire") && (
                        <details>
                          <summary>Modifier</summary>
                          <form action={changeMember.bind(null, cid, m.userId)}>
                            <RoleSelect value={m.role} owner={me.role === "proprietaire"} />
                            <EmissionChoice c={c} scope={m.emissions} prefix="edit" />
                            <button type="submit" className="button secondary small">
                              Enregistrer
                            </button>
                          </form>
                          <form action={removeMember.bind(null, cid, m.userId)}>
                            <ConfirmSubmit label="Retirer du collectif" confirm="Oui, retirer" />
                          </form>
                        </details>
                      )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {manage && (
        <>
          <form action={inviteMember.bind(null, cid)} className="card">
            <h2>Inviter un membre</h2>
            <label className="field">
              Adresse e-mail
              <input type="email" name="email" required data-testid="invite-email" />
            </label>
            <RoleSelect value="animateur" owner={false} />
            <EmissionChoice c={c} prefix="invite" />
            <label className="field">
              Le lien expire dans
              <select name="jours" defaultValue="7">
                {INVITE_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} jour{d > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button" data-testid="invite-submit">
              Inviter
            </button>
          </form>
          {c.memberInvites.length > 0 && (
            <section className="card">
              <h2>Invitations</h2>
              <ul className="plain" data-testid="member-invites">
                {[...c.memberInvites].reverse().map((i) => {
                  const st = linkState(i);
                  const link = `${origin}/rejoindre/${cid}.${i.id}`;
                  return (
                    <li key={i.id} data-testid="member-invite" data-state={st}>
                      <strong>{i.email}</strong> · {roleLabel(i.role)} · {LINK_LABEL[st]}
                      {st === "valide" && (
                        <>
                          {" "}
                          · expire le {frDay(i.expiresAt)}
                          <br />
                          <code className="link" data-testid="member-invite-link">
                            {link}
                          </code>{" "}
                          <CopyButton text={link} />{" "}
                          <form
                            action={revokeMemberInvite.bind(null, cid, i.id)}
                            className="inline"
                          >
                            <button type="submit" className="linklike">
                              Révoquer
                            </button>
                          </form>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function RoleSelect({ value, owner }: { value: Role; owner: boolean }) {
  return (
    <label className="field">
      Rôle
      <select name="role" defaultValue={value} data-testid="role-select">
        {ROLES.filter((r) => owner || r.key !== "proprietaire").map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      <small className="hint role-help">
        {ROLES.filter((r) => owner || r.key !== "proprietaire")
          .map((r) => `${r.label} : ${r.help}.`)
          .join(" ")}
      </small>
    </label>
  );
}
