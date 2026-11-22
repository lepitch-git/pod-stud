"use client";

import { useEffect, useState } from "react";

/** Bouton « Copier le lien ». */
export function CopyButton({ text, testId }: { text: string; testId?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="button secondary small"
      data-testid={testId}
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          })
          .catch(() => undefined)
      }
    >
      {done ? "Copié" : "Copier le lien"}
    </button>
  );
}

/** Bouton en deux temps : un premier clic demande confirmation, sans fenêtre surgissante. */
export function ConfirmSubmit({
  label,
  confirm,
  className = "button secondary small",
  testId,
}: {
  label: string;
  confirm: string;
  className?: string;
  testId?: string;
}) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="confirm-inline">
      <button type="submit" className="button danger small" data-testid={`${testId}-ok`}>
        {confirm}
      </button>{" "}
      <button type="button" className="linklike" onClick={() => setArmed(false)}>
        Annuler
      </button>
    </span>
  ) : (
    <button type="button" className={className} onClick={() => setArmed(true)} data-testid={testId}>
      {label}
    </button>
  );
}

/**
 * Archivage d'une session (ENR-20, CPT-11) : explique les conséquences et demande de recopier
 * le nom de la session.
 */
export function ArchiveForm({
  name,
  action,
}: {
  name: string;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open)
    return (
      <button
        type="button"
        className="menu-item"
        onClick={() => setOpen(true)}
        data-testid="session-archive"
      >
        Archiver…
      </button>
    );
  return (
    <form
      action={action}
      className="dialog"
      role="dialog"
      aria-label="Archiver la session"
      data-testid="archive-dialog"
    >
      <h3>Archiver « {name} » ?</h3>
      <ul>
        <li>
          Les fichiers passent en archive froide, moins chère : ils ne sont plus téléchargeables
          tels quels.
        </li>
        <li>
          Pour les récupérer, il faut restaurer la session ; une fois le stockage définitif branché,
          la restauration prendra quelques heures (immédiate sur le lien de test).
        </li>
        <li>La session passe dans le filtre « Archivé » de l&apos;émission.</li>
      </ul>
      <label className="field">
        Pour confirmer, recopiez le nom de la session
        <input
          name="confirmation"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          data-testid="archive-confirm-input"
        />
      </label>
      <p>
        <button
          type="submit"
          className="button danger"
          disabled={typed !== name}
          data-testid="archive-confirm"
        >
          Archiver la session
        </button>{" "}
        <button type="button" className="linklike" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </p>
    </form>
  );
}

/** Choix mémorisé dans le navigateur (tri, vue grille ou liste). */
export function useRemembered<T extends string>(key: string, initial: T, allowed: T[]) {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      if (s && allowed.includes(s)) setV(s);
    } catch {
      /* stockage du navigateur indisponible */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (x: T) => {
    setV(x);
    try {
      localStorage.setItem(key, x);
    } catch {
      /* stockage du navigateur indisponible */
    }
  };
  return [v, set] as const;
}
