"use client";

import {
  detectBrowser,
  evaluateCapabilities,
  type BrowserInfo,
  type Diagnostic,
} from "@pod-stud/shared";
import { useEffect, useState } from "react";
import { probeCapabilities } from "@/lib/probe";

const ICON = { ok: "✅", warn: "⚠️", ko: "❌" } as const;
const WORD = { ok: "Vert", warn: "Orange", ko: "Rouge" } as const;

function buildReport(browser: BrowserInfo, d: Diagnostic): string {
  const lines = [
    `Diagnostic Pod Stud, version ${process.env.NEXT_PUBLIC_APP_VERSION}`,
    `Date : ${new Date().toLocaleString("fr-FR")}`,
    `Navigateur : ${browser.label}`,
    `Verdict : ${WORD[d.verdict]}`,
    ...d.checks.map((c) => `${ICON[c.status]} ${c.label} : ${c.detail}`),
  ];
  return lines.join("\n");
}

export default function DiagnosticView() {
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBrowser(detectBrowser(navigator.userAgent));
    probeCapabilities()
      .then((p) => setDiag(evaluateCapabilities(p)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="verdict verdict-ko">Le diagnostic a échoué : {error}</p>;
  if (!diag || !browser) return <p aria-busy="true">Analyse en cours…</p>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildReport(browser, diag));
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section data-testid="diagnostic" data-verdict={diag.verdict}>
      <p className="browser">
        Navigateur détecté : <strong data-testid="browser-label">{browser.label}</strong>
      </p>
      <p className={`verdict verdict-${diag.verdict}`} data-testid="verdict">
        {ICON[diag.verdict]} {diag.summary}
      </p>
      <ul className="checks">
        {diag.checks.map((c) => (
          <li
            key={c.id}
            className={`check check-${c.status}`}
            data-testid={`check-${c.id}`}
            data-status={c.status}
          >
            <span className="icon" aria-hidden>
              {ICON[c.status]}
            </span>
            <div>
              <strong>{c.label}</strong>
              <p>{c.detail}</p>
              <small>Exigence : {c.requirement}</small>
            </div>
          </li>
        ))}
      </ul>
      <p>
        <button type="button" className="button" onClick={copy} data-testid="copy-report">
          {copied ? "Rapport copié" : "Copier le rapport pour le cahier de recette"}
        </button>
      </p>
    </section>
  );
}
