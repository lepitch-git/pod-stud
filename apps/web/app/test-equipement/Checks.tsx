import type { CheckStatus, EquipmentCheck } from "@pod-stud/shared";

export const ICON: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️", ko: "❌" };

export function Checks({ checks, testId }: { checks: EquipmentCheck[]; testId?: string }) {
  return (
    <ul className="checks" data-testid={testId}>
      {checks.map((c) => (
        <li
          key={c.id}
          className={`check check-${c.status}`}
          data-testid={`eq-${c.id}`}
          data-status={c.status}
        >
          <span className="icon" aria-hidden>
            {ICON[c.status]}
          </span>
          <div>
            <strong>{c.label}</strong>
            <p>{c.detail}</p>
            {c.advice && <p className="advice">{c.advice}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Meter({ db }: { db: number }) {
  // -60 dBFS à 0 dBFS ; zone cible de la voix entre -32 et -14 dBFS
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const zone = db > -6 ? "ko" : db > -14 ? "warn" : db > -32 ? "ok" : "low";
  return (
    <div
      className="meter"
      role="meter"
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={Math.round(db)}
      aria-label="Niveau du micro"
      data-testid="vu-meter"
    >
      <div
        className="meter-target"
        style={{ left: `${(28 / 60) * 100}%`, width: `${(18 / 60) * 100}%` }}
      />
      <div className={`meter-bar meter-${zone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
