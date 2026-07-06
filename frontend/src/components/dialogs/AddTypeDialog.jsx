import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ICON_OPTIONS, getCustomTypeMetas } from "@/lib/objectTypes";
import { addCustomType, removeCustomType } from "@/lib/typeRegistry";

export function AddTypeDialog({ open, onOpenChange, onCreated }) {
  const [name, setName] = useState("");
  const [iconName, setIconName] = useState("Shapes");
  const [error, setError] = useState("");
  const [existing, setExisting] = useState([]);

  useEffect(() => {
    if (open) {
      setName("");
      setIconName("Shapes");
      setError("");
      setExisting(getCustomTypeMetas());
    }
  }, [open]);

  const create = () => {
    setError("");
    try {
      const type = addCustomType(name, iconName);
      onCreated(type);
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not create type");
    }
  };

  const remove = (key) => {
    removeCustomType(key);
    setExisting(getCustomTypeMetas());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="add-type-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Add a custom type</DialogTitle>
          <DialogDescription>
            Create your own object type — it appears in the sidebar and the New menu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type name</label>
            <input
              autoFocus
              data-testid="add-type-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="e.g. Recipe, Habit, Quote…"
              className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Icon</label>
            <div className="grid grid-cols-9 gap-1.5">
              {ICON_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = iconName === opt.name;
                return (
                  <button
                    key={opt.name}
                    onClick={() => setIconName(opt.name)}
                    data-testid={`add-type-icon-${opt.name}`}
                    className={`flex aspect-square items-center justify-center rounded-lg border transition-colors ${
                      active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-ink"
                    }`}
                    aria-label={opt.name}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs text-destructive" data-testid="add-type-error">{error}</p>}

          <button
            onClick={create}
            data-testid="add-type-create-btn"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-background hover:bg-ink/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Create type
          </button>

          {existing.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your types</p>
              <div className="space-y-1" data-testid="add-type-existing">
                {existing.map((t) => {
                  const Icon = t.icon;
                  return (
                    <div key={t.key} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-accent/50">
                      <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} />
                      <span className="flex-1 truncate">{t.label}</span>
                      <button
                        onClick={() => remove(t.key)}
                        data-testid={`add-type-remove-${t.key}`}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${t.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
