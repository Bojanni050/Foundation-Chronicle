import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { SettingsDialog } from "./SettingsDialog";

export function SettingsWithHermesSkills({ open, onOpenChange }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const enabledCount = useMemo(
    () => skills.filter((skill) => skill.enabled).length,
    [skills]
  );

  const loadSkills = async () => {
    const { apiUrl } = getSettings();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/settings/gaia-hermes-skills`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setSkills(Array.isArray(data.skills) ? data.skills : []);
    } catch (err) {
      setSkills([]);
      setError(`Hermes-skills konden niet worden geladen (${err.message}).`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadSkills();
  }, [open]);

  const toggleSkill = async (name, enabled) => {
    const { apiUrl } = getSettings();
    const previous = skills;
    const next = skills.map((skill) =>
      skill.name === name ? { ...skill, enabled } : skill
    );
    setSkills(next);
    setSaving(name);
    setError("");

    try {
      const enabledMap = Object.fromEntries(
        next.map((skill) => [skill.name, skill.enabled === true])
      );
      const response = await fetch(`${apiUrl}/api/settings/gaia-hermes-skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enabledMap }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setSkills(Array.isArray(data.skills) ? data.skills : next);
    } catch (err) {
      setSkills(previous);
      setError(`Skillinstelling kon niet worden opgeslagen (${err.message}).`);
    } finally {
      setSaving("");
    }
  };

  return (
    <>
      <SettingsDialog open={open} onOpenChange={onOpenChange} />

      {open && (
        <aside
          data-testid="gaia-hermes-skills-panel"
          className="fixed right-[14vw] top-[17vh] z-[100] w-[min(32rem,34vw)] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-background/98 p-4 shadow-2xl backdrop-blur"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-serif text-base text-ink">Gaia · Hermes-skills</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Alleen aangevinkte skills worden aan Gaia aangeboden. Nieuwe Hermes-skills staan standaard uit.
              </p>
            </div>
            <button
              type="button"
              onClick={loadSkills}
              disabled={loading}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-card hover:text-ink disabled:opacity-40"
              title="Skills opnieuw uitlezen uit Hermes"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{skills.length} gevonden</span>
            <span>{enabledCount} ingeschakeld</span>
          </div>

          {error && (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {!loading && !error && skills.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Hermes heeft geen skills gerapporteerd. Gaia gebruikt daarom geen skills.
            </p>
          )}

          <div className="mt-3 space-y-2">
            {skills.map((skill) => (
              <label
                key={skill.name}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5 hover:bg-card/70"
              >
                <input
                  type="checkbox"
                  checked={skill.enabled === true}
                  disabled={saving === skill.name}
                  onChange={(event) => toggleSkill(skill.name, event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                  data-testid={`gaia-hermes-skill-${skill.name}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {skill.label || skill.name}
                    {saving === skill.name && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </span>
                  <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">
                    {skill.description || skill.name}
                  </span>
                  <code className="mt-1 block text-[10px] text-muted-foreground/70">{skill.name}</code>
                </span>
              </label>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
