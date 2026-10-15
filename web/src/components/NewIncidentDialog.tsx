import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Severity } from "../lib/api";
import { Button, inputClass, Modal } from "./ui";

const SEVERITY_HELP: Record<Severity, string> = {
  SEV1: "Critical: core product down or data at risk",
  SEV2: "Major: key feature degraded for many users",
  SEV3: "Minor: limited impact, workaround exists",
};

export function NewIncidentDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("SEV2");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { incident } = await api.createIncident({ title, severity });
      navigate(`/incidents/${incident.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create incident");
      setSaving(false);
    }
  };

  return (
    <Modal title="Declare an incident" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-300">What's happening?</span>
          <input
            autoFocus
            className={inputClass}
            placeholder="Checkout returning 500 errors"
            value={title}
            minLength={3}
            maxLength={120}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm text-zinc-300">Severity</legend>
          {(Object.keys(SEVERITY_HELP) as Severity[]).map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                severity === s ? "border-zinc-400 bg-zinc-800/60" : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <input type="radio" name="severity" className="mt-1 accent-zinc-100" checked={severity === s} onChange={() => setSeverity(s)} />
              <span>
                <span className="font-semibold">{s}</span>
                <span className="block text-zinc-400">{SEVERITY_HELP[s]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={saving || title.trim().length < 3}>
            {saving ? "Opening…" : "Open incident room"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
