import {
  Plus,
  Search,
  Inbox,
  Activity,
  Settings,
  ChevronDown,
  Upload,
  Sparkles,
  CircleDashed,
  Fingerprint,
  Waypoints,
  Cpu,
  Lock,
  Copy,
  Radio,
  Brain,
} from "lucide-react";
import { OBJECT_TYPES } from "@/lib/objectTypes";
import { useTypes } from "@/hooks/useTypes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function NavRow({ icon: Icon, label, count, active, onClick, testId, iconClassName = "" }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-ink"
      }`}
    >
      <Icon
        className={`w-[18px] h-[18px] ${active ? "text-primary" : "text-muted-foreground group-hover:text-primary/80"} ${iconClassName}`}
        strokeWidth={1.75}
      />
      <span className="flex-1 text-left truncate">{label}</span>
      {typeof count === "number" && (
        <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>
      )}
    </button>
  );
}

export function Sidebar({
  counts,
  view,
  onSelectView,
  onNew,
  onImport,
  onAddType,
  onSearch,
  onPulse,
  pulseBusy,
  onPersona,
  onGraph,
  onEngine,
  onDedup,
  onCaptureLog,
  onMemory,
  onLock,
  onSettings,
  workspaceName,
}) {
  const allTypes = useTypes();
  const customTypes = allTypes.filter((t) => t.isCustom);
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-background/60">
      {/* brand */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
          <Sparkles className="h-4 w-4 text-primary" strokeWidth={2} />
        </div>
        <span className="font-serif text-lg text-ink">Chronicle</span>
      </div>

      {/* actions */}
      <div className="px-3 space-y-0.5">
        <div className="flex items-center gap-1">
          <button
            data-testid="new-entry-btn"
            onClick={() => onNew(null)}
            className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-accent/60 transition-colors"
          >
            <Plus className="w-[18px] h-[18px] text-primary" strokeWidth={2} />
            <span className="flex-1 text-left">New</span>
            <kbd className="text-[11px] text-muted-foreground/60">Ctrl+N</kbd>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="new-menu-btn"
                aria-label="More new options"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-ink transition-colors"
              >
                <ChevronDown className="w-4 h-4" strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem data-testid="new-menu-untyped" onClick={() => onNew(null)}>
                <CircleDashed className="w-4 h-4 mr-2 text-muted-foreground" strokeWidth={1.75} />
                Quick note
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {OBJECT_TYPES.filter((t) => t.key !== "chat" && t.key !== "activity").map((t) => (
                <DropdownMenuItem
                  key={t.key}
                  data-testid={`new-menu-${t.key}`}
                  onClick={() => onNew(t.key)}
                >
                  <t.icon className="w-4 h-4 mr-2 text-muted-foreground" strokeWidth={1.75} />
                  New {t.singular}
                </DropdownMenuItem>
              ))}
              {customTypes.length > 0 && <DropdownMenuSeparator />}
              {customTypes.map((t) => (
                <DropdownMenuItem
                  key={t.key}
                  data-testid={`new-menu-${t.key}`}
                  onClick={() => onNew(t.key)}
                >
                  <t.icon className="w-4 h-4 mr-2 text-primary/80" strokeWidth={1.75} />
                  New {t.singular}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="new-menu-add-type" onClick={onAddType}>
                <Plus className="w-4 h-4 mr-2 text-primary" strokeWidth={1.75} />
                Add type…
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="new-menu-import" onClick={onImport}>
                <Upload className="w-4 h-4 mr-2 text-primary" strokeWidth={1.75} />
                Import chat…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button
          data-testid="sidebar-search-btn"
          onClick={onSearch}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-ink transition-colors"
        >
          <Search className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[11px] text-muted-foreground/60">Ctrl+K</kbd>
        </button>
      </div>

      <div className="mx-3 my-3 border-t border-border" />

      <NavRow
        icon={Inbox}
        label="All objects"
        count={counts.all || 0}
        active={view === "all"}
        onClick={() => onSelectView("all")}
        testId="nav-all"
      />

      <p className="px-6 pt-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        Object types
      </p>

      <nav className="flex-1 overflow-y-auto px-3 no-scrollbar">
        {/* "activity" is deliberately excluded here — it's passive, AI-collected
            context (app/window capture from the UIA pipeline), not content the
            user browses like notes/chats/etc. It's still viewable from Settings. */}
        {OBJECT_TYPES.filter((t) => t.key !== "activity").map((t) => (
          <NavRow
            key={t.key}
            icon={t.icon}
            label={t.label}
            count={counts[t.key] || 0}
            active={view === t.key}
            onClick={() => onSelectView(t.key)}
            testId={`nav-${t.key}`}
          />
        ))}
        {customTypes.map((t) => (
          <NavRow
            key={t.key}
            icon={t.icon}
            label={t.label}
            count={counts[t.key] || 0}
            active={view === t.key}
            onClick={() => onSelectView(t.key)}
            testId={`nav-${t.key}`}
          />
        ))}
        <NavRow
          icon={CircleDashed}
          label="Untyped"
          count={counts.untyped || 0}
          active={view === "untyped"}
          onClick={() => onSelectView("untyped")}
          testId="nav-untyped"
        />
      </nav>

      {/* footer */}
      <div className="mt-auto border-t border-border px-3 py-2">
        <NavRow
          icon={Activity}
          label="AI Pulse"
          active={false}
          onClick={onPulse}
          testId="nav-pulse"
          iconClassName={pulseBusy ? "animate-pulse" : ""}
        />
        <NavRow icon={Fingerprint} label="Persona" active={false} onClick={onPersona} testId="nav-persona" />
        <NavRow icon={Waypoints} label="Knowledge graph" active={false} onClick={onGraph} testId="nav-graph" />
        <NavRow icon={Cpu} label="Chronicle Engine" active={false} onClick={onEngine} testId="nav-engine" />
        <NavRow icon={Copy} label="Find duplicates" active={false} onClick={onDedup} testId="nav-dedup" />
        <NavRow icon={Radio} label="Capture log" active={false} onClick={onCaptureLog} testId="nav-capture-log" />
        <NavRow icon={Brain} label="Evidence memory" active={false} onClick={onMemory} testId="nav-memory" />
        <NavRow icon={Lock} label="Lock workspace" active={false} onClick={onLock} testId="nav-lock" />
        <button
          onClick={onSettings}
          data-testid="workspace-footer"
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent/50 transition-colors"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary">
            <Settings className="w-4 h-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{workspaceName}</p>
            <p className="text-[11px] text-muted-foreground">{counts.all || 0} objects · solo mode</p>
          </div>
        </button>
      </div>
    </aside>
  );
}
