import { assessDevice, recommendDevice, type DeviceKind } from "@pod-stud/shared";

const NAMES: Record<DeviceKind, string> = {
  micro: "Micro",
  camera: "Caméra",
  sortie: "Sortie audio",
};

/** Liste déroulante d'un type de périphérique, avec l'appareil conseillé signalé et un conseil adapté. */
export function DeviceSelect({
  kind,
  devices,
  value,
  onChange,
  testId,
}: {
  kind: DeviceKind;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  testId: string;
}) {
  const best = devices.length > 1 ? recommendDevice(devices, kind) : null;
  const current = devices.find((d) => d.deviceId === value);
  const note = current ? assessDevice(current.label, kind).note : undefined;
  return (
    <>
      <label className="field">
        {NAMES[kind]} utilisé{kind === "camera" || kind === "sortie" ? "e" : ""}
        {devices.length > 1 && <span className="hint"> ({devices.length} disponibles)</span>}
        <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {(d.label || `${NAMES[kind]} ${i + 1}`) + (d.deviceId === best ? " (conseillé)" : "")}
            </option>
          ))}
        </select>
      </label>
      {best && best !== value && (
        <p className="hint" data-testid={`${testId}-advice`}>
          Conseillé : {devices.find((d) => d.deviceId === best)?.label}.{" "}
          <button type="button" className="linklike" onClick={() => onChange(best)}>
            L&apos;utiliser
          </button>
        </p>
      )}
      {note && (
        <p className="advice-box" data-testid={`${testId}-note`}>
          ⚠️ {note}
        </p>
      )}
    </>
  );
}
